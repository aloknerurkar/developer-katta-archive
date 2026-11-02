import { describe, expect, it } from 'vitest'
import { InvalidIndexError, MAX_ENTRIES, MAX_FIELD, addEntry, emptyIndex, parseIndex, serializeIndex, type ArchiveEntry } from '../src/swarm/types'

const entry: ArchiveEntry = {
  reference: 'ab'.repeat(32),
  contentType: 'text/plain',
  title: 'Grinding song',
  language: 'Marathi',
  region: 'Konkan',
  contributor: 'Katta team',
  date: '2026-11-03',
}

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

describe('index model', () => {
  it('round-trips through serialize and parse', () => {
    const index = addEntry(emptyIndex('Test archive'), entry)
    expect(parseIndex(serializeIndex(index))).toEqual(index)
  })

  it('adds new entries first', () => {
    const second = { ...entry, reference: 'cd'.repeat(32), title: 'Second' }
    const index = addEntry(addEntry(emptyIndex('a'), entry), second)
    expect(index.entries.map(e => e.title)).toEqual(['Second', 'Grinding song'])
  })

  it('lowercases references', () => {
    const index = parseIndex(encode({ version: 1, name: 'a', entries: [{ ...entry, reference: 'AB'.repeat(32) }] }))
    expect(index.entries[0].reference).toBe('ab'.repeat(32))
  })

  it.each([
    ['non-JSON bytes', new TextEncoder().encode('not json')],
    ['a JSON array', encode([])],
    ['an unknown version', encode({ version: 2, name: 'a', entries: [] })],
    ['a missing name', encode({ version: 1, entries: [] })],
    ['entries that are not an array', encode({ version: 1, name: 'a', entries: {} })],
    ['a short reference', encode({ version: 1, name: 'a', entries: [{ ...entry, reference: 'ab' }] })],
    ['a non-hex reference', encode({ version: 1, name: 'a', entries: [{ ...entry, reference: 'zz'.repeat(32) }] })],
    ['an oversized field', encode({ version: 1, name: 'a', entries: [{ ...entry, title: 'x'.repeat(MAX_FIELD + 1) }] })],
    ['a non-string field', encode({ version: 1, name: 'a', entries: [{ ...entry, region: 7 }] })],
    ['too many entries', encode({ version: 1, name: 'a', entries: Array(MAX_ENTRIES + 1).fill(entry) })],
  ])('rejects %s', (_label, bytes) => {
    expect(() => parseIndex(bytes)).toThrow(InvalidIndexError)
  })
})
