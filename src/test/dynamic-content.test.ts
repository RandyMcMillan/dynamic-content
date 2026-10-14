import test from 'node:test'
import assert from 'node:assert/strict'

import { DynamicContent } from '../dynamic-content.js'

test('DynamicContent produces identical IDs for identical input', async () => {
  const a = await DynamicContent({ protocol: '/dynamic-content-example/set/1.0.0', param: { network: 1 } })
  const b = await DynamicContent({ protocol: '/dynamic-content-example/set/1.0.0', param: { network: 1 } })
  assert.equal(a.id.toString(), b.id.toString())
})

test('DynamicContent produces different IDs for different params', async () => {
  const a = await DynamicContent({ protocol: '/dynamic-content-example/set/1.0.0', param: { network: 1 } })
  const b = await DynamicContent({ protocol: '/dynamic-content-example/set/1.0.0', param: { network: 2 } })
  assert.notEqual(a.id.toString(), b.id.toString())
})