import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { AllPathsFailedError, fetchVerified, verifyBytes } from '../src/swarm/reader'
import { refOf, startFakeBee, type FakeBee } from './fake-bee'

// 10 000 bytes = 3 leaf chunks + 1 root: exercises the chunk tree, not just one chunk.
const data = new Uint8Array(10_000).map((_, i) => (i * 7) % 256)
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

let bees: FakeBee[] = []
let hung: Server[] = []
afterEach(async () => {
  await Promise.all([
    ...bees.map(b => b.close()),
    ...hung.map(s => new Promise<void>(resolve => {
      s.closeAllConnections()
      s.close(() => resolve())
    })),
  ])
  bees = []
  hung = []
})

// A gateway that accepts the connection and never answers.
async function hangingGateway(): Promise<string> {
  const server = createServer(() => {})
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  hung.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function bee(opts: { down?: boolean; tamper?: boolean } = {}, content?: [string, Uint8Array]) {
  const b = await startFakeBee(opts)
  if (content) b.store.set(...content)
  bees.push(b)
  return b
}

describe('verifyBytes', () => {
  it('accepts bytes whose BMT root matches the reference', async () => {
    expect(await verifyBytes(data, await refOf(data))).toBe(true)
  })

  it('rejects altered bytes', async () => {
    const ref = await refOf(data)
    const altered = data.slice()
    altered[5000] ^= 1
    expect(await verifyBytes(altered, ref)).toBe(false)
  })
})

describe('fetchVerified', () => {
  it('returns content from the first healthy path and skips the rest', async () => {
    const ref = await refOf(data)
    const a = await bee({}, [ref, data])
    const b = await bee({}, [ref, data])
    const result = await fetchVerified([a.url, b.url], ref)
    expect(result.url).toBe(a.url)
    expect(same(result.data, data)).toBe(true)
    expect(result.failures).toEqual([])
    expect(b.requests).toEqual([])
  })

  it('falls back when a path is down', async () => {
    const ref = await refOf(data)
    const a = await bee({ down: true })
    const b = await bee({}, [ref, data])
    const result = await fetchVerified([a.url, b.url], ref)
    expect(result.url).toBe(b.url)
    expect(result.failures.map(f => f.url)).toEqual([a.url])
  })

  it('rejects a lying gateway and falls back to an honest one', async () => {
    const ref = await refOf(data)
    const liar = await bee({ tamper: true }, [ref, data])
    const honest = await bee({}, [ref, data])
    const result = await fetchVerified([liar.url, honest.url], ref)
    expect(result.url).toBe(honest.url)
    expect(same(result.data, data)).toBe(true)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].reason).toMatch(/^hash mismatch/)
  })

  it('gives up on a gateway that never answers and falls back', async () => {
    const ref = await refOf(data)
    const hang = await hangingGateway()
    const good = await bee({}, [ref, data])
    const started = Date.now()
    const result = await fetchVerified([hang, good.url], ref, 300)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.url).toBe(good.url)
    expect(same(result.data, data)).toBe(true)
    expect(result.failures.map(f => f.url)).toEqual([hang])
  }, 5_000)

  it('throws AllPathsFailedError listing every failure when no path serves verified content', async () => {
    const ref = await refOf(data)
    const down = await bee({ down: true })
    const liar = await bee({ tamper: true }, [ref, data])
    const err = await fetchVerified([down.url, liar.url], ref).catch(e => e)
    expect(err).toBeInstanceOf(AllPathsFailedError)
    expect((err as AllPathsFailedError).failures.map(f => f.url)).toEqual([down.url, liar.url])
  })
})
