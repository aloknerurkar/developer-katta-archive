import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ChunkSplitter } from '@ethersphere/bee-js'
import { unmarshalContentAddressedChunk } from '@ethersphere/core-sdk/chunk'

export interface FakeBee {
  url: string
  store: Map<string, Uint8Array>
  chunks: { address: string; stamped: boolean }[]
  requests: string[]
  // swarm-deferred-upload header of each request, index-aligned with `requests` ('' when absent)
  deferredHeaders: string[]
  close(): Promise<void>
}

export async function refOf(data: Uint8Array): Promise<string> {
  return (await ChunkSplitter.root(data)).hash().toHex()
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    req.on('data', (p: Buffer) => parts.push(p))
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts))))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

// Speaks just enough of the Bee API for unit tests: /bytes, /chunks.
export async function startFakeBee(opts: { down?: boolean; tamper?: boolean } = {}): Promise<FakeBee> {
  const store = new Map<string, Uint8Array>()
  const chunks: FakeBee['chunks'] = []
  const requests: string[] = []
  const deferredHeaders: string[] = []
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    requests.push(`${req.method} ${path}`)
    deferredHeaders.push(String(req.headers['swarm-deferred-upload'] ?? ''))
    if (opts.down) return json(res, 503, { code: 503, message: 'node is down' })
    if (req.method === 'POST' && path === '/bytes') {
      const body = await readBody(req)
      const reference = await refOf(body)
      store.set(reference, body)
      return json(res, 201, { reference })
    }
    if (req.method === 'POST' && path === '/chunks') {
      const body = await readBody(req)
      const address = unmarshalContentAddressedChunk(body).address.toHex()
      chunks.push({ address, stamped: typeof req.headers['swarm-postage-stamp'] === 'string' })
      return json(res, 201, { reference: address })
    }
    const m = /^\/bytes\/([0-9a-f]{64})$/.exec(path)
    if (req.method === 'GET' && m) {
      const body = store.get(m[1])
      if (!body) return json(res, 404, { code: 404, message: 'Not Found' })
      const out = Buffer.from(body)
      if (opts.tamper) out[out.length >> 1] ^= 0xff
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(out)
      return
    }
    json(res, 404, { code: 404, message: 'Not Found' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    chunks,
    requests,
    deferredHeaders,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
