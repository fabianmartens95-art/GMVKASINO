function atomic(value) {
  return BigInt(String(value ?? '0'))
}

function countBy(rows, key) {
  return rows.reduce((summary, row) => {
    const value = String(row[key] || 'unknown')
    summary[value] = (summary[value] || 0) + 1
    return summary
  }, {})
}

function expectedPointers(operation) {
  if (operation.kind === 'deposit') {
    return {
      reservation: false,
      settlement: operation.status === 'completed',
      reversal: false,
    }
  }
  return {
    reservation: true,
    settlement: operation.status === 'completed',
    reversal: operation.status === 'rejected' || operation.status === 'failed',
  }
}

function pointerMismatch(operation, field, expected) {
  const value = operation[field]
  if (expected && !value) return `${field}_missing`
  if (!expected && value) return `${field}_unexpected`
  return null
}

function postingExpectation(operation, transactionType) {
  const amount = atomic(operation.amount_atomic)
  if (transactionType === 'SANDBOX_DEPOSIT') {
    return {
      expectedType: 'SANDBOX_DEPOSIT',
      entries: [
        { owner: 'player', purpose: 'available', amount },
        { owner: 'system', purpose: 'payment_clearing', amount: -amount },
      ],
    }
  }
  if (transactionType === 'SANDBOX_WITHDRAWAL_RESERVE') {
    return {
      expectedType: 'SANDBOX_WITHDRAWAL_RESERVE',
      entries: [
        { owner: 'player', purpose: 'available', amount: -amount },
        { owner: 'player', purpose: 'withdrawal_reserved', amount },
      ],
    }
  }
  if (transactionType === 'SANDBOX_WITHDRAWAL_RELEASE') {
    return {
      expectedType: 'SANDBOX_WITHDRAWAL_RELEASE',
      entries: [
        { owner: 'player', purpose: 'withdrawal_reserved', amount: -amount },
        { owner: 'player', purpose: 'available', amount },
      ],
    }
  }
  if (transactionType === 'SANDBOX_WITHDRAWAL') {
    return {
      expectedType: 'SANDBOX_WITHDRAWAL',
      entries: [
        { owner: 'player', purpose: 'withdrawal_reserved', amount: -amount },
        { owner: 'system', purpose: 'payment_clearing', amount },
      ],
    }
  }
  return null
}

function entryMatches(entry, expected, accountId) {
  const ownerMatches = expected.owner === 'player'
    ? entry.account_id === accountId && entry.system_key === null
    : entry.account_id === null && entry.system_key === 'demo_payment_clearing'
  return ownerMatches
    && entry.purpose === expected.purpose
    && atomic(entry.amount_atomic) === expected.amount
}

function expectedTerminalEvent(operation) {
  if (operation.kind === 'deposit') {
    if (operation.status === 'completed') return 'complete'
    if (operation.status === 'failed') return 'fail'
    return null
  }
  if (operation.status === 'completed') return 'complete'
  if (operation.status === 'rejected') return 'reject'
  if (operation.status === 'failed') return 'fail'
  if (operation.status === 'approved') return 'approve'
  return null
}

export class PaymentReconciler {
  constructor({ pool, now = Date.now } = {}) {
    if (!pool) throw new Error('PaymentReconciler requires a pool')
    this.pool = pool
    this.now = now
  }

  async reconcile() {
    const operationsResult = await this.pool.query(
      `SELECT
         id,
         account_id,
         kind,
         asset_code,
         amount_atomic::text AS amount_atomic,
         status,
         reservation_transaction_id,
         settlement_transaction_id,
         reversal_transaction_id,
         created_at,
         updated_at
       FROM payment_operations
       ORDER BY created_at, id`,
    )
    const operations = operationsResult.rows

    const transactionResult = await this.pool.query(
      `SELECT
         lt.id,
         lt.type,
         lt.reference_type,
         lt.reference_id,
         lt.asset_code,
         la.account_id,
         la.system_key,
         la.purpose,
         le.amount_atomic::text AS amount_atomic
       FROM ledger_transactions lt
       LEFT JOIN ledger_entries le ON le.transaction_id = lt.id
       LEFT JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE lt.reference_type = 'payment_operation'
       ORDER BY lt.id, le.id`,
    )
    const transactions = new Map()
    for (const row of transactionResult.rows) {
      if (!transactions.has(row.id)) {
        transactions.set(row.id, {
          id: row.id,
          type: row.type,
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          assetCode: row.asset_code,
          entries: [],
        })
      }
      if (row.purpose !== null) {
        transactions.get(row.id).entries.push({
          account_id: row.account_id,
          system_key: row.system_key,
          purpose: row.purpose,
          amount_atomic: row.amount_atomic,
        })
      }
    }

    const eventsResult = await this.pool.query(
      `SELECT payment_operation_id, event_type, COUNT(*)::int AS count
       FROM payment_events
       GROUP BY payment_operation_id, event_type
       ORDER BY payment_operation_id, event_type`,
    )
    const events = new Map()
    for (const row of eventsResult.rows) {
      if (!events.has(row.payment_operation_id)) events.set(row.payment_operation_id, new Map())
      events.get(row.payment_operation_id).set(row.event_type, Number(row.count))
    }

    const operationMismatches = []
    const transactionMismatches = []
    const eventMismatches = []

    for (const operation of operations) {
      if (operation.asset_code !== 'DEMO') {
        operationMismatches.push({
          paymentOperationId: operation.id,
          code: 'unexpected_asset',
          assetCode: operation.asset_code,
        })
      }

      const pointers = expectedPointers(operation)
      for (const [name, expected] of Object.entries(pointers)) {
        const field = `${name}_transaction_id`
        const code = pointerMismatch(operation, field, expected)
        if (code) operationMismatches.push({ paymentOperationId: operation.id, code })
      }

      const pointerChecks = []
      if (operation.reservation_transaction_id) {
        pointerChecks.push([operation.reservation_transaction_id, 'SANDBOX_WITHDRAWAL_RESERVE'])
      }
      if (operation.settlement_transaction_id) {
        pointerChecks.push([
          operation.settlement_transaction_id,
          operation.kind === 'deposit' ? 'SANDBOX_DEPOSIT' : 'SANDBOX_WITHDRAWAL',
        ])
      }
      if (operation.reversal_transaction_id) {
        pointerChecks.push([operation.reversal_transaction_id, 'SANDBOX_WITHDRAWAL_RELEASE'])
      }

      for (const [transactionId, expectedType] of pointerChecks) {
        const transaction = transactions.get(transactionId)
        if (!transaction) {
          transactionMismatches.push({
            paymentOperationId: operation.id,
            transactionId,
            code: 'referenced_transaction_missing',
            expectedType,
          })
          continue
        }
        if (
          transaction.type !== expectedType
          || transaction.referenceType !== 'payment_operation'
          || transaction.referenceId !== operation.id
          || transaction.assetCode !== 'DEMO'
        ) {
          transactionMismatches.push({
            paymentOperationId: operation.id,
            transactionId,
            code: 'transaction_metadata_mismatch',
            expectedType,
            actualType: transaction.type,
          })
          continue
        }

        const expectation = postingExpectation(operation, expectedType)
        if (!expectation || transaction.entries.length !== 2) {
          transactionMismatches.push({
            paymentOperationId: operation.id,
            transactionId,
            code: 'transaction_entry_shape_mismatch',
            entryCount: transaction.entries.length,
          })
          continue
        }

        const matched = expectation.entries.every((expected) => (
          transaction.entries.some((entry) => entryMatches(entry, expected, operation.account_id))
        ))
        const balanced = transaction.entries.reduce(
          (sum, entry) => sum + atomic(entry.amount_atomic),
          0n,
        ) === 0n
        if (!matched || !balanced) {
          transactionMismatches.push({
            paymentOperationId: operation.id,
            transactionId,
            code: 'transaction_amount_or_account_mismatch',
          })
        }
      }

      const expectedEvent = expectedTerminalEvent(operation)
      if (expectedEvent) {
        const count = events.get(operation.id)?.get(expectedEvent) || 0
        if (count !== 1) {
          eventMismatches.push({
            paymentOperationId: operation.id,
            code: 'expected_event_count_mismatch',
            eventType: expectedEvent,
            expectedCount: 1,
            actualCount: count,
          })
        }
      }
      if (operation.kind === 'withdrawal' && operation.status === 'completed') {
        const approvalCount = events.get(operation.id)?.get('approve') || 0
        if (approvalCount !== 1) {
          eventMismatches.push({
            paymentOperationId: operation.id,
            code: 'approval_event_count_mismatch',
            expectedCount: 1,
            actualCount: approvalCount,
          })
        }
      }
    }

    for (const transaction of transactions.values()) {
      const operation = operations.find((item) => item.id === transaction.referenceId)
      if (!operation) {
        transactionMismatches.push({
          transactionId: transaction.id,
          paymentOperationId: transaction.referenceId,
          code: 'orphan_payment_transaction',
        })
      }
    }

    const reserveResult = await this.pool.query(
      `WITH expected AS (
         SELECT account_id, COALESCE(SUM(amount_atomic), 0)::numeric AS expected_atomic
         FROM payment_operations
         WHERE kind = 'withdrawal'
           AND status IN ('reserved', 'approved')
         GROUP BY account_id
       ), actual AS (
         SELECT account_id, balance_atomic AS actual_atomic
         FROM ledger_accounts
         WHERE asset_code = 'DEMO'
           AND purpose = 'withdrawal_reserved'
       )
       SELECT
         COALESCE(expected.account_id, actual.account_id) AS account_id,
         COALESCE(expected.expected_atomic, 0)::text AS expected_atomic,
         COALESCE(actual.actual_atomic, 0)::text AS actual_atomic
       FROM expected
       FULL OUTER JOIN actual ON actual.account_id = expected.account_id
       ORDER BY account_id`,
    )
    const reserveMismatches = reserveResult.rows
      .filter((row) => atomic(row.expected_atomic) !== atomic(row.actual_atomic))
      .map((row) => ({
        accountId: row.account_id,
        expectedAtomic: row.expected_atomic,
        actualAtomic: row.actual_atomic,
        deltaAtomic: (atomic(row.actual_atomic) - atomic(row.expected_atomic)).toString(),
      }))

    const countsByKind = countBy(operations, 'kind')
    const countsByStatus = countBy(operations, 'status')
    const checkedAt = new Date(this.now()).toISOString()
    const mismatchCount = operationMismatches.length
      + transactionMismatches.length
      + eventMismatches.length
      + reserveMismatches.length

    return {
      ok: mismatchCount === 0,
      checkedAt,
      sandbox: true,
      mode: 'demo',
      operationsChecked: operations.length,
      paymentTransactionsChecked: transactions.size,
      summary: {
        totalOperations: operations.length,
        countsByKind,
        countsByStatus,
        mismatchCount,
      },
      operationMismatches,
      transactionMismatches,
      eventMismatches,
      reserveMismatches,
    }
  }

  async sanitizedSummary() {
    const report = await this.reconcile()
    return {
      ok: report.ok,
      checkedAt: report.checkedAt,
      sandbox: true,
      mode: 'demo',
      operationsChecked: report.operationsChecked,
      paymentTransactionsChecked: report.paymentTransactionsChecked,
      countsByKind: report.summary.countsByKind,
      countsByStatus: report.summary.countsByStatus,
      mismatchCount: report.summary.mismatchCount,
      mismatchCategories: {
        operations: report.operationMismatches.length,
        transactions: report.transactionMismatches.length,
        events: report.eventMismatches.length,
        reserves: report.reserveMismatches.length,
      },
    }
  }
}
