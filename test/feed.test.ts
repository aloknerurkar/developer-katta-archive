import { describe, expect, it } from 'vitest'
import { INDEX_TOPIC, KEEPER_KEY_STORAGE, SITE_TOPIC, keeperAddress, loadOrCreateKeeperKey } from '../src/swarm/feed'
import { MemStore } from './mem-store'

describe('keeper key', () => {
  it('creates a key once and returns the same key afterwards', () => {
    const store = new MemStore()
    const first = loadOrCreateKeeperKey(store)
    const again = loadOrCreateKeeperKey(store)
    expect(again.toHex()).toBe(first.toHex())
    expect(store.getItem(KEEPER_KEY_STORAGE)).toBe(first.toHex())
  })

  it.each([
    ['non-hex characters', '12'.repeat(31) + 'zz'],
    ['a trailing newline', '12'.repeat(32) + '\n'],
    ['the wrong length', '12'.repeat(31)],
  ])('refuses a stored key with %s, without echoing it or overwriting it', (_why, stored) => {
    const store = new MemStore()
    store.setItem(KEEPER_KEY_STORAGE, stored)
    const err = (() => {
      try {
        loadOrCreateKeeperKey(store)
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toBe('stored keeper key is malformed')
    expect(err?.message).not.toContain(stored.trim())
    expect(err?.cause).toBeUndefined()
    expect(store.getItem(KEEPER_KEY_STORAGE)).toBe(stored)
  })

  it('derives a 40-hex owner address', () => {
    expect(keeperAddress(loadOrCreateKeeperKey(new MemStore()))).toMatch(/^[0-9a-f]{40}$/)
  })

  it('creates different keys in different browsers', () => {
    expect(loadOrCreateKeeperKey(new MemStore()).toHex()).not.toBe(loadOrCreateKeeperKey(new MemStore()).toHex())
  })
})

describe('topics', () => {
  it('keeps the index feed and the site feed apart', () => {
    expect(INDEX_TOPIC.toHex()).not.toBe(SITE_TOPIC.toHex())
  })
})
