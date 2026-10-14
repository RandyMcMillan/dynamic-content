import type { Helia } from '@helia/interface'
import type { IPNS } from '@helia/ipns'

import { DynamicContent } from './dynamic-content.js'

declare global {
  var client1: Helia
  var client2: Helia
  var server: Helia
  var name1: IPNS
  var name2: IPNS
  var dynamicContent: Awaited<ReturnType<typeof DynamicContent>>
  var set1: Set<any>
  var set2: Set<any>
  var cid1: string
  var cid2: string
  var update: (...values: string[]) => Promise<void>
  var sync: () => Promise<void>
  var update1: (...values: string[]) => Promise<void>
  var update2: (...values: string[]) => Promise<void>
  var sync1: () => Promise<void>
  var sync2: () => Promise<void>
  var connect: (client: Helia) => Promise<void>
  var disconnect: (client: Helia) => Promise<void>
  var help: string
}