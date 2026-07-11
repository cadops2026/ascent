import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCorrelationMatrix, cholesky, classCorrelation } from '../correlation.ts'

const TEN = ['us_equity', 'intl_equity', 'bonds', 'tips', 'cash', 'real_estate', 'commodities', 'private_equity', 'collectibles', 'crypto']
const corrToUs = [1, 0.85, 0.15, 0.1, 0, 0.6, 0.3, 0.75, 0.25, 0.4]

test('matrix is symmetric with unit diagonal and the key safe-asset fix', () => {
  const m = buildCorrelationMatrix(TEN, corrToUs)
  for (let i = 0; i < TEN.length; i++) {
    assert.equal(m[i]![i], 1)
    for (let j = 0; j < TEN.length; j++) assert.equal(m[i]![j], m[j]![i])
  }
  const bi = TEN.indexOf('bonds')
  const ti = TEN.indexOf('tips')
  // The fix: bonds↔TIPS is ~0.8, not the single-factor 0.15·0.10 = 0.015.
  assert.equal(m[bi]![ti], 0.8)
  assert.ok(m[bi]![ti]! > 0.5, 'safe-asset co-movement must not collapse to ~0')
})

test('classCorrelation is symmetric, reflexive, and clamped', () => {
  assert.equal(classCorrelation('bonds', 'tips', 0.15, 0.1), 0.8)
  assert.equal(classCorrelation('tips', 'bonds', 0.1, 0.15), 0.8)
  assert.equal(classCorrelation('us_equity', 'us_equity', 1, 1), 1)
  // Unknown pair falls back to the single-factor product.
  assert.equal(classCorrelation('foo', 'bar', 0.5, 0.4), 0.2)
})

test('the full 10-class matrix is positive semi-definite (Cholesky, zero ridge)', () => {
  const m = buildCorrelationMatrix(TEN, corrToUs)
  const L = cholesky(m)
  // Reconstruct L·Lᵀ and compare to m. If a ridge had been needed, the diagonal
  // would drift > 1; an exact reconstruction proves the seeded matrix is valid PSD.
  let maxDiff = 0
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m.length; j++) {
      let s = 0
      for (let k = 0; k <= Math.min(i, j); k++) s += L[i]![k]! * L[j]![k]!
      maxDiff = Math.max(maxDiff, Math.abs(s - m[i]![j]!))
    }
  }
  assert.ok(maxDiff < 1e-9, `reconstruction error ${maxDiff} — matrix not PSD without ridge`)
})

test('Cholesky is lower-triangular', () => {
  const L = cholesky(buildCorrelationMatrix(TEN, corrToUs))
  for (let i = 0; i < L.length; i++)
    for (let j = i + 1; j < L.length; j++) assert.equal(L[i]![j], 0)
})
