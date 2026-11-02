import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { PrivateKey } from '@ethersphere/bee-js'
import { makeBee } from '../src/swarm/clients'
import { INDEX_TOPIC, keeperAddress } from '../src/swarm/feed'
import { refOf, startFakeBee, type FakeBee } from './fake-bee'

const REF = '00'.repeat(32)
const BATCH = 'ab'.repeat(32)
const KEY = new PrivateKey('00'.repeat(31) + '01')
const OWNER = keeperAddress(KEY)

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

// A node that accepts the connection and never answers.
async function hangingNode(): Promise<string> {
  const server = createServer(() => {})
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  hung.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

// How long `p` takes to reject, failing the test if it resolves.
async function rejectionTime(p: Promise<unknown>): Promise<number> {
  const started = Date.now()
  const outcome = await p.then(() => 'resolved', () => 'rejected')
  expect(outcome).toBe('rejected')
  return Date.now() - started
}

describe('makeBee timeout', () => {
  it('bounds a download from a node that never answers', async () => {
    const hang = await hangingNode()
    expect(await rejectionTime(makeBee(hang, 300).data.download(REF))).toBeLessThan(2_000)
  }, 5_000)

  it('bounds a feed read from a node that never answers', async () => {
    const hang = await hangingNode()
    const read = makeBee(hang, 300).feed.makeReader(INDEX_TOPIC, OWNER).downloadReference()
    expect(await rejectionTime(read)).toBeLessThan(2_000)
  }, 5_000)

  it('bounds a feed write to a node that never answers', async () => {
    const hang = await hangingNode()
    const write = makeBee(hang, 300).feed.makeWriter(INDEX_TOPIC, KEY).uploadReference(BATCH, REF, { deferred: false })
    expect(await rejectionTime(write)).toBeLessThan(2_000)
  }, 5_000)

  it('still applies when the caller passes a signal that never fires', async () => {
    const hang = await hangingNode()
    const idle = new AbortController().signal
    expect(await rejectionTime(makeBee(hang, 300).data.download(REF, undefined, { signal: idle }))).toBeLessThan(2_000)
  }, 5_000)

  it('lets a shorter caller signal win over the timeout', async () => {
    const hang = await hangingNode()
    const caller = AbortSignal.timeout(300)
    expect(await rejectionTime(makeBee(hang, 60_000).data.download(REF, undefined, { signal: caller }))).toBeLessThan(2_000)
  }, 5_000)

  it('gives each call its own deadline, so one client keeps working past timeoutMs', async () => {
    const data = new Uint8Array(100).map((_, i) => i)
    const node = await startFakeBee()
    bees.push(node)
    const ref = await refOf(data)
    node.store.set(ref, data)
    const bee = makeBee(node.url, 300)
    await new Promise(resolve => setTimeout(resolve, 450))
    expect((await bee.data.download(ref)).toUint8Array()).toEqual(data)
    expect((await bee.data.download(ref)).toUint8Array()).toEqual(data)
  })

  it('does not get in the way of a normal request', async () => {
    const data = new Uint8Array(100).map((_, i) => i)
    const node = await startFakeBee()
    bees.push(node)
    const bee = makeBee(node.url)
    const { reference } = await bee.data.upload(BATCH, data)
    expect(reference.toHex()).toBe(await refOf(data))
    expect((await bee.data.download(reference)).toUint8Array()).toEqual(data)
  })
})
