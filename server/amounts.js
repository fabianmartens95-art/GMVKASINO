function assertScale(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 30) {
    throw new Error('asset scale must be an integer between 0 and 30')
  }
}

export function decimalToAtomic(value, scale) {
  assertScale(scale)
  const raw = String(value).trim()
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error('amount must be a plain decimal number')

  const [, sign, whole, fraction = ''] = match
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) {
    throw new Error(`amount exceeds asset precision of ${scale} decimals`)
  }

  const paddedFraction = fraction.slice(0, scale).padEnd(scale, '0')
  const units = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(paddedFraction || '0')
  return `${sign === '-' && units !== 0n ? '-' : ''}${units}`
}

export function atomicToDecimalString(value, scale) {
  assertScale(scale)
  const atomic = BigInt(String(value))
  const negative = atomic < 0n
  const absolute = negative ? -atomic : atomic
  const factor = 10n ** BigInt(scale)
  const whole = absolute / factor

  if (scale === 0) return `${negative ? '-' : ''}${whole}`

  const fraction = (absolute % factor).toString().padStart(scale, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export function atomicToNumber(value, scale) {
  const decimal = atomicToDecimalString(value, scale)
  const parsed = Number(decimal)
  if (!Number.isFinite(parsed)) throw new Error('amount is outside numeric API range')
  return parsed
}
