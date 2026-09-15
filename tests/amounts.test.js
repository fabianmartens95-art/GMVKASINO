import test from 'node:test'
import assert from 'node:assert/strict'
import { atomicToDecimalString, atomicToNumber, decimalToAtomic } from '../server/amounts.js'

test('decimalToAtomic preserves exact asset precision without floating point math', () => {
  assert.equal(decimalToAtomic('1', 2), '100')
  assert.equal(decimalToAtomic('12.34', 2), '1234')
  assert.equal(decimalToAtomic('0.00000001', 8), '1')
  assert.equal(decimalToAtomic('1.2300', 2), '123')
  assert.equal(decimalToAtomic('-4.5', 2), '-450')
})

test('decimalToAtomic rejects values that exceed configured precision', () => {
  assert.throws(() => decimalToAtomic('1.001', 2), /exceeds asset precision/)
  assert.throws(() => decimalToAtomic('not-a-number', 2), /plain decimal/)
})

test('atomic amounts format back to exact decimal strings', () => {
  assert.equal(atomicToDecimalString('1234', 2), '12.34')
  assert.equal(atomicToDecimalString('-1', 8), '-0.00000001')
  assert.equal(atomicToNumber('98200', 2), 982)
})
