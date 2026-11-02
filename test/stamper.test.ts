import { afterEach, describe, expect, it } from 'vitest'
import { makeBee } from '../src/swarm/clients'
import { decodeState, encodeState, loadStamper, saveStamper, stateKey, uploadSelfStamped } from '../src/swarm/stamper'
import { refOf, startFakeBee, type FakeBee } from './fake-bee'
import { MemStore } from './mem-store'

const KEY = '11'.repeat(32)
const BATCH = 'bb'.repeat(32)
// i * 13 repeats every 256 bytes, so 4096-aligned leaves would be identical; the i >> 12 term makes each leaf differ.
const data = new Uint8Array(10_000).map((_, i) => (i * 13 + (i >> 12)) % 256)
let node: FakeBee | null = null
afterEach(async () => {
  await node?.close()
  node = null
})

describe('stamper state', () => {
  it('round-trips through a string', () => {
    const state = new Uint32Array(65536)
    state[0] = 3
    state[65535] = 7
    expect(decodeState(encodeState(state))).toEqual(state)
  })

  it('restores counters so a bucket slot is never handed out twice', () => {
    const store = new MemStore()
    const first = loadStamper(store, KEY, BATCH, 17) // depth 17: 2 slots per bucket
    const address = new Uint8Array(32) // bucket 0
    first.stamp(address)
    first.stamp(address)
    saveStamper(store, BATCH, first)
    const restored = loadStamper(store, KEY, BATCH, 17)
    expect(() => restored.stamp(address)).toThrow(/bucket is full/)
  })

  it('rejects a stored state that does not hold exactly 65536 counters', () => {
    // a short table would silently hand out the same slot index twice
    for (const length of [0, 8, 65535, 65537]) {
      expect(() => decodeState(encodeState(new Uint32Array(length)))).toThrow(/65536/)
    }
    expect(() => decodeState('00'.repeat(7))).toThrow(/65536/) // not even a whole number of counters
    const store = new MemStore()
    store.setItem(stateKey(BATCH), encodeState(new Uint32Array(8)))
    expect(() => loadStamper(store, KEY, BATCH, 20)).toThrow(/65536/)
  })
})

describe('uploadSelfStamped', () => {
  it('sends every chunk, root included, with a stamp and returns the content reference', async () => {
    const fake = await startFakeBee()
    node = fake
    const store = new MemStore()
    const stamper = loadStamper(store, KEY, BATCH, 20)
    const uploadedAtPersist: number[] = []
    const persist = () => {
      uploadedAtPersist.push(fake.chunks.length)
      saveStamper(store, BATCH, stamper)
    }
    const ref = await uploadSelfStamped(makeBee(fake.url), stamper, data, persist)
    expect(ref).toBe(await refOf(data))
    expect(fake.chunks).toHaveLength(4) // 3 leaves + root
    expect(fake.chunks.every(c => c.stamped)).toBe(true)
    expect(fake.chunks.at(-1)?.address).toBe(ref)
    const saved = decodeState(store.getItem(stateKey(BATCH)) ?? '')
    expect(saved.reduce((a, b) => a + b, 0)).toBe(4)
    // crash safety: the counters are saved before each chunk leaves, never after
    expect(uploadedAtPersist).toEqual([0, 1, 2, 3])
    // read-after-write: every chunk upload asks the node for a direct (non-deferred) write
    const chunkPosts = fake.requests.flatMap((r, i) => (r === 'POST /chunks' ? [fake.deferredHeaders[i]] : []))
    expect(chunkPosts).toEqual(['false', 'false', 'false', 'false'])
  })

  it('uploads repeated content once and does not burn a stamp slot per copy', async () => {
    node = await startFakeBee()
    const store = new MemStore()
    const stamper = loadStamper(store, KEY, BATCH, 17) // 2 slots per bucket: three stamps of one chunk would overflow
    const zeros = new Uint8Array(20 * 4096) // 20 identical leaves
    const ref = await uploadSelfStamped(makeBee(node.url), stamper, zeros, () => saveStamper(store, BATCH, stamper))
    expect(ref).toBe(await refOf(zeros))
    expect(node.chunks).toHaveLength(2) // the zero leaf once + the root
    expect(new Set(node.chunks.map(c => c.address)).size).toBe(2)
    expect(node.chunks.at(-1)?.address).toBe(ref)
    const saved = decodeState(store.getItem(stateKey(BATCH)) ?? '')
    expect(saved.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('still uploads every distinct chunk when only some of the data repeats', async () => {
    node = await startFakeBee()
    const store = new MemStore()
    const stamper = loadStamper(store, KEY, BATCH, 20)
    const mixed = new Uint8Array(4 * 4096)
    mixed.set(data.subarray(0, 4096), 2 * 4096) // zero, zero, pattern, zero
    const ref = await uploadSelfStamped(makeBee(node.url), stamper, mixed, () => saveStamper(store, BATCH, stamper))
    expect(ref).toBe(await refOf(mixed))
    expect(node.chunks).toHaveLength(3) // zero leaf, pattern leaf, root
    expect(new Set(node.chunks.map(c => c.address)).size).toBe(3)
  })
})
