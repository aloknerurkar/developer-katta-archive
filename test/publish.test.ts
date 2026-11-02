import { afterEach, describe, expect, it } from 'vitest'
import { makeBee } from '../src/swarm/clients'
import { publishBytes, publishEntry, publishIndex } from '../src/swarm/publish'
import { fetchVerified } from '../src/swarm/reader'
import { emptyIndex, parseIndex, addEntry, InvalidIndexError, MAX_ENTRIES } from '../src/swarm/types'
import { refOf, startFakeBee, type FakeBee } from './fake-bee'

const BATCH = 'aa'.repeat(32)
const data = new TextEncoder().encode('ovi: a grinding song, sung at dawn')
let node: FakeBee | null = null
afterEach(async () => {
  await node?.close()
  node = null
})

describe('publish', () => {
  it('uploads bytes and returns their content reference', async () => {
    node = await startFakeBee()
    const ref = await publishBytes(makeBee(node.url), BATCH, data)
    expect(ref).toBe(await refOf(data))
    expect(node.requests).toContain('POST /bytes')
  })

  it('returns an entry whose reference reads back verified', async () => {
    node = await startFakeBee()
    const entry = await publishEntry(makeBee(node.url), BATCH, data, {
      contentType: 'text/plain', title: 'Ovi', language: 'Marathi', region: 'Pune', contributor: 'Katta', date: '2026-11-03',
    })
    const { url } = await fetchVerified([node.url], entry.reference)
    expect(url).toBe(node.url)
    expect(entry.title).toBe('Ovi')
  })

  it('publishes an index that parses back to the same value', async () => {
    node = await startFakeBee()
    const index = addEntry(emptyIndex('Test'), { reference: 'ab'.repeat(32), contentType: 'text/plain', title: 't', language: 'l', region: 'r', contributor: 'c', date: '2026-11-03' })
    const ref = await publishIndex(makeBee(node.url), BATCH, index)
    const { data: stored } = await fetchVerified([node.url], ref)
    expect(parseIndex(stored)).toEqual(index)
  })

  it('refuses to publish an index that readers would reject, without uploading', async () => {
    node = await startFakeBee()
    const entry = { reference: 'ab'.repeat(32), contentType: 'text/plain', title: 't', language: 'l', region: 'r', contributor: 'c', date: '2026-11-03' }
    const tooMany = { ...emptyIndex('Test'), entries: Array.from({ length: MAX_ENTRIES + 1 }, () => entry) }
    await expect(publishIndex(makeBee(node.url), BATCH, tooMany)).rejects.toBeInstanceOf(InvalidIndexError)
    expect(node.requests).toEqual([])
  })
})
