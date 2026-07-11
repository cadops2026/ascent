import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cmaClassForHolding,
  COARSE_OF_CMA,
  CMA_KEY_FOR_COARSE,
  CMA_CLASSES,
  ASSET_CLASSES,
} from '../assetclass.ts'
import type { Holding } from '../../db.ts'

const h = (kind: string, symbol: string | null): Pick<Holding, 'kind' | 'symbol'> => ({ kind, symbol })

test('fixed income / TIPS / intl / commodities / money-market route to their true class', () => {
  assert.equal(cmaClassForHolding(h('etf', 'BND')), 'bonds')
  assert.equal(cmaClassForHolding(h('etf', 'AGG')), 'bonds')
  assert.equal(cmaClassForHolding(h('etf', 'MUB')), 'bonds') // muni
  assert.equal(cmaClassForHolding(h('etf', 'TIP')), 'tips')
  assert.equal(cmaClassForHolding(h('etf', 'VTIP')), 'tips')
  assert.equal(cmaClassForHolding(h('etf', 'VXUS')), 'intl_equity')
  assert.equal(cmaClassForHolding(h('etf', 'VWO')), 'intl_equity')
  assert.equal(cmaClassForHolding(h('etf', 'GLD')), 'commodities')
  assert.equal(cmaClassForHolding(h('stock', 'VMFXX')), 'cash') // money-market fund
})

test('equities and non-fund kinds classify correctly; unknown tickers → us_equity', () => {
  assert.equal(cmaClassForHolding(h('stock', 'AAPL')), 'us_equity')
  assert.equal(cmaClassForHolding(h('etf', 'VTI')), 'us_equity')
  assert.equal(cmaClassForHolding(h('etf', 'ZZZZ')), 'us_equity') // unknown → conservative default
  assert.equal(cmaClassForHolding(h('etf', null)), 'us_equity')
  assert.equal(cmaClassForHolding(h('crypto', 'BTC')), 'crypto')
  assert.equal(cmaClassForHolding(h('private', null)), 'private_equity')
  assert.equal(cmaClassForHolding(h('collectible', null)), 'collectibles')
  assert.equal(cmaClassForHolding(h('cash', null)), 'cash')
})

test('symbol matching is case-insensitive', () => {
  assert.equal(cmaClassForHolding(h('etf', 'bnd')), 'bonds')
  assert.equal(cmaClassForHolding(h('etf', 'vxus')), 'intl_equity')
})

test('coarse↔fine maps are total and mutually consistent', () => {
  // Every fine class maps to a coarse class.
  for (const c of CMA_CLASSES) assert.ok(ASSET_CLASSES.includes(COARSE_OF_CMA[c]))
  // Every coarse class maps to a fine key that maps back to that coarse class.
  for (const a of ASSET_CLASSES) {
    const fine = CMA_KEY_FOR_COARSE[a]
    assert.equal(COARSE_OF_CMA[fine], a, `${a} → ${fine} → ${COARSE_OF_CMA[fine]}`)
  }
})
