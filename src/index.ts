import { kadDHT } from '@libp2p/kad-dht'
import { ipns, IPNS } from '@helia/ipns'
import { dht } from '@helia/ipns/routing'
import { ipnsValidator } from 'ipns/validator'
import { ipnsSelector } from 'ipns/selector'
import { CID } from 'multiformats/cid'
import * as Block from 'multiformats/block'
import * as codec from '@ipld/dag-cbor'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import all from 'it-all'
import type { Helia } from '@helia/interface'
import type { ProviderEvent } from '@libp2p/interface-dht'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { BlockView } from 'multiformats/interface'

import './globals.js'
import { createHeliaNode } from './create-helia.js'
import { DynamicContent } from './dynamic-content.js'

const createKadDht = (clientMode: boolean) =>
  kadDHT({
    validators: { ipns: ipnsValidator },
    selectors: { ipns: ipnsSelector },
    clientMode
  })

const createLibp2pConfig = (clientMode: boolean) => ({
  dht: createKadDht(clientMode), // kademlia dht instance
  connectionManager: { minConnections: 0 } // disable autodial
})

const client1 = await createHeliaNode(createLibp2pConfig(true))
const client2 = await createHeliaNode(createLibp2pConfig(true))
const server = await createHeliaNode(createLibp2pConfig(false))
console.log('server is pinning ipld and serving dht ipns and provider records')

const name1 = ipns(client1, [dht(client1)])
const name2 = ipns(client2, [dht(client2)])

// manifest document describes the dynamic content
const dynamicContent = await DynamicContent({
  protocol: '/dynamic-content-example/set/1.0.0',
  param: { network: 1 }
})
// dynamic-content id is permutation of the manifest document's cid
const dcid = dynamicContent.id

// (dcid -> ipns)
// add ipns key as provider for dcid with retry logic
const advertise = (client: Helia) => async () => {
  let attempts = 0;
  while (attempts < 3) {
    try {
      await all(client.libp2p.dht.provide(dcid));
      return;
    } catch (err) {
      attempts++;
      if (attempts >= 3) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};
// find providers of dcid to get ipns of collaborators
const query = (client: Helia) => async (): Promise<PeerId[]> => {
  let i = 0
  let providers: ProviderEvent[] = []
  while (providers.length === 0 && i < 3) {
    const responses = await all(client.libp2p.dht.findProviders(dcid))
    providers = responses.filter(r => r.name === 'PROVIDER') as ProviderEvent[]
    i++
  }

  if (i > 0) {
    // the first query after dialing the protocol often returns an empty response
    console.log('dht query returned empty response')
  }
  if (i === 3) {
    throw new Error('cannot find providers')
  }

  // Collect every advertised provider, so all collaborators can be synced.
  const peerIds = new Map<string, PeerId>()
  for (const evt of providers) {
    for (const p of evt.providers) {
      peerIds.set(p.id.toString(), p.id)
    }
  }
  const result = [...peerIds.values()]
  if (result.length === 0) {
    throw new Error('cannot find providers')
  }
  return result
}

// (ipns -> cid)
// update ipns record
const publish = (client: Helia, name: IPNS) => async (cid: CID) => await name.publish(client.libp2p.peerId, cid)
// resolve ipns record
const resolve = (name: IPNS) => async (peerId: PeerId) => await name.resolve(peerId)

// (cid -> data)
// push data to reliable host
const push = async (b: BlockView<string[], 113, 18, 1>) => await server.blockstore.put(b.cid, b.bytes)
// pull data over ipfs
const pull = (client: Helia) => async (cid: CID) => await client.blockstore.get(cid)

// (data -> set)
// encode set to ipld
const encode = async (s: Set<string>) =>
  await Block.encode<string[], 113, 18>({ value: Array.from(s), codec, hasher })
// decode set from ipld
const decode = async (bytes: Uint8Array) =>
  new Set((await Block.decode<string[], 113, 18>({ bytes, codec, hasher })).value)

// (set + set)
// add value to set
const add = (s: Set<string>) => (v: string) => s.add(v)
// merge local and remote replicas
const merge = (l: Set<string>, r: Set<string>) => r.forEach(l.add.bind(l))

const set1: Set<string> = new Set()
const set2: Set<string> = new Set()

const getClientName = (client: Helia) => client === client1 ? 'client1' : 'client2'

// Generic write path: any client can publish its own replica.
const updateFor = (client: Helia, name: IPNS, set: Set<string>) => async (...values: string[]) => {
  const who = getClientName(client)
  const diff = Array.from(values).filter(value => !set.has(value))
  for (const value of values) { add(set)(value) }
  console.log(`${who}: added new values to set { ${diff.join(', ')} }`)
  console.log(`${who}: set state: { ${Array.from(set).join(', ')} }`)
  const block = await encode(set)
  console.log(`${who}: encoded to raw data`)
  await push(block)
  console.log(`${who}: pushed data to pinner`)
  await publish(client, name)(block.cid)
  console.log(`${who}: published ipns:${client.libp2p.peerId} with value cid:${block.cid}`)
  await advertise(client)()
  console.log(`${who}: advertised ipns:${client.libp2p.peerId} as set provider`)
}

// Generic read path: merge changes from ALL discovered collaborators.
const syncFor = (client: Helia, name: IPNS, set: Set<string>) => async () => {
  const who = getClientName(client)
  const peerIds = await query(client)()
  console.log(`${who}: found ${peerIds.length} provider(s)`)
  for (const peerId of peerIds) {
    if (peerId.toString() === client.libp2p.peerId.toString()) continue
    try {
      const cid = await resolve(name)(peerId)
      console.log(`${who}: resolved ipns:${peerId} to ${cid}`)
      const bytes = await pull(client)(cid)
      console.log(`${who}: resolved ipfs:${cid} to raw data`)
      const remote = await decode(bytes)
      console.log(`${who}: decoded raw data`)
      const diff = Array.from(remote).filter(value => !set.has(value))
      merge(set, remote)
      console.log(`${who}: added new values to set { ${diff.join(', ')} }`)
    } catch (err: any) {
      console.log(`${who}: could not sync provider ${peerId}: ${err?.message ?? err}`)
    }
  }
  console.log(`${who}: set state: { ${Array.from(set).join(', ')} }`)
}

const update1 = updateFor(client1, name1, set1)
const update2 = updateFor(client2, name2, set2)
const sync1 = syncFor(client1, name1, set1)
const sync2 = syncFor(client2, name2, set2)

// Backwards-compatible globals used by the original example/docs.
const update = update1
const sync = sync2

const connect = async (client: Helia) => {
  await client.libp2p.dial((server.libp2p.getMultiaddrs())[0])
  // allow identify / topology to populate the Kademlia routing table
  await new Promise(resolve => setTimeout(resolve, 2000))
  console.log('%s: online', getClientName(client))
}
const disconnect = async (client: Helia) => {
  await Promise.all(client.libp2p.getConnections().map(connection => connection.close()))
  console.log('%s: offline', getClientName(client))
}

// Run the full automated example only when this file is the entry point.
if (process.argv[1] && process.argv[1].endsWith('dynamic-content/dist/index.js')) {
  // client1 comes online, makes changes, and goes offline
  {
    await connect(client1)
    await update('nerf this')
    await disconnect(client1)
  }

  console.log(`
--- no peers online, Zzzzz ---
`)

  await new Promise(resolve => setTimeout(resolve, 3000))

  // client2 comes online, merges changes, and goes offline
  {
    await connect(client2)
    await sync()
    await disconnect(client2)
  }

  await Promise.all([
    client1.stop(),
    client2.stop(),
    server.stop()
  ])
  await process.exit(0)
}

global.client1 = client1
global.client2 = client2
global.server = server
global.name1 = name1
global.name2 = name2
global.set1 = set1
global.set2 = set2
global.dynamicContent = dynamicContent
global.update = update
global.sync = sync
global.update1 = update1
global.update2 = update2
global.sync1 = sync1
global.sync2 = sync2
global.connect = connect
global.disconnect = disconnect
