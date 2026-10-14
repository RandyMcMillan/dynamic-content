import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Load the core example so the Helia nodes + helpers become globals.
await import('./index.js')

const G = globalThis as any
const connect = G.connect as (c: any) => Promise<void>
const disconnect = G.disconnect as (c: any) => Promise<void>
const updateFor = (name: string) => (name === 'client1' ? G.update1 : G.update2) as (...v: string[]) => Promise<void>
const syncFor = (name: string) => (name === 'client1' ? G.sync1 : G.sync2) as () => Promise<void>

const PORT = Number(process.env.PORT ?? 8080)
const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.join(here, '..', 'web')

function readBody (req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => (data += c))
    req.on('end', () => {
      if (!data) return resolve({})
      try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function status () {
  const c1 = G.client1, c2 = G.client2, srv = G.server
  return {
    set1: Array.from(G.set1 ?? []),
    set2: Array.from(G.set2 ?? []),
    cid1: G.cid1 ?? null,
    cid2: G.cid2 ?? null,
    sha256Set1: crypto.createHash('sha256').update(JSON.stringify(Array.from(G.set1 ?? []))).digest('hex'),
    sha256Set2: crypto.createHash('sha256').update(JSON.stringify(Array.from(G.set2 ?? []))).digest('hex'),
    client1Connections: c1?.libp2p?.getConnections?.().length ?? 0,
    client2Connections: c2?.libp2p?.getConnections?.().length ?? 0,
    client1PeerId: c1?.libp2p?.peerId?.toString?.() ?? null,
    client2PeerId: c2?.libp2p?.peerId?.toString?.() ?? null,
    ipns1: c1?.libp2p?.peerId ? `/ipns/${c1.libp2p.peerId.toString()}` : null,
    ipns2: c2?.libp2p?.peerId ? `/ipns/${c2.libp2p.peerId.toString()}` : null,
    serverMultiaddrs: (srv?.libp2p?.getMultiaddrs?.() ?? []).map((a: any) => a.toString())
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/'
  if (url === '/api/status' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(status()))
    return
  }
  if (url === '/api/connect' && req.method === 'POST') {
    try {
      const b = await readBody(req)
      await connect(b.client === 'client2' ? G.client2 : G.client1)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, ...status() }))
    } catch (e: any) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }))
    }
    return
  }
  if (url === '/api/disconnect' && req.method === 'POST') {
    try {
      const b = await readBody(req)
      await disconnect(b.client === 'client2' ? G.client2 : G.client1)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, ...status() }))
    } catch (e: any) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }))
    }
    return
  }
  if (url === '/api/update' && req.method === 'POST') {
    try {
      const b = await readBody(req)
      const values = String(b.values ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
      await updateFor(b.client ?? 'client1')(...values)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, ...status() }))
    } catch (e: any) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }))
    }
    return
  }
  if (url === '/api/sync' && req.method === 'POST') {
    try {
      const b = await readBody(req)
      await syncFor(b.client ?? 'client2')()
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, ...status() }))
    } catch (e: any) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }))
    }
    return
  }
  if (url === '/api/reset' && req.method === 'POST') {
    try {
      // Clear the same Set instances captured by update/sync closures.
      G.set1.clear()
      G.set2.clear()
      G.cid1 = undefined
      G.cid2 = undefined
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, ...status() }))
    } catch (e: any) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }))
    }
    return
  }

  if (url === '/favicon.ico') {
    res.statusCode = 204
    res.end()
    return
  }

  const file = url === '/' ? 'index.html' : url.replace(/^\//, '')
  const full = path.join(webRoot, file)
  if (!full.startsWith(webRoot) || !fs.existsSync(full)) {
    res.statusCode = 204
    res.end()
    return
  }
  const ext = path.extname(full)
  const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream'
  res.setHeader('content-type', mime)
  fs.createReadStream(full).pipe(res)
})

server.listen(PORT, () => {
  console.log(`web demo listening on http://localhost:${PORT}`)
})
