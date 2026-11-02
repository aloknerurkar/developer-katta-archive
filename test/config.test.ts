import { describe, expect, it } from 'vitest'
import { loadConfig, readPaths } from '../src/config'

const base = {
  VITE_WRITE_URL: 'https://w.example/',
  VITE_READ_URLS: 'https://a.example, https://b.example/',
  VITE_BATCH_ID: 'ab'.repeat(32),
}

describe('loadConfig', () => {
  it('parses values and strips trailing slashes', () => {
    const c = loadConfig(base)
    expect(c.writeUrl).toBe('https://w.example')
    expect(c.readUrls).toEqual(['https://a.example', 'https://b.example'])
    expect(c.batchId).toBe('ab'.repeat(32))
    expect(c.archiveOwner).toBeNull()
    expect(c.adoptUrl).toBeNull()
  })

  it('rejects missing required values with a pointer to the cheat sheet', () => {
    expect(() => loadConfig({ ...base, VITE_BATCH_ID: '' })).toThrow(/cheat sheet/)
  })

  it('rejects a malformed batch id', () => {
    expect(() => loadConfig({ ...base, VITE_BATCH_ID: 'xyz' })).toThrow(/64 hex/)
  })

  it('reads optional owner and adopt settings', () => {
    const c = loadConfig({ ...base, VITE_ARCHIVE_OWNER: 'cd'.repeat(20), VITE_ADOPT_URL: 'https://b.example/', VITE_ADOPT_BATCH_ID: 'ef'.repeat(32) })
    expect(c.archiveOwner).toBe('cd'.repeat(20))
    expect(c.adoptUrl).toBe('https://b.example')
    expect(c.adoptBatchId).toBe('ef'.repeat(32))
  })
})

describe('readPaths', () => {
  const c = loadConfig(base)

  it('puts the serving node first when the app is served from /bzz/', () => {
    expect(readPaths(c, { origin: 'https://c.example', pathname: '/bzz/abc/' })).toEqual([
      'https://c.example',
      'https://a.example',
      'https://b.example',
    ])
  })

  it('does not duplicate a serving node that is already listed', () => {
    expect(readPaths(c, { origin: 'https://b.example', pathname: '/bzz/abc/' })).toEqual(['https://a.example', 'https://b.example'])
  })

  it('ignores the origin when the app is not served from /bzz/', () => {
    expect(readPaths(c, { origin: 'http://localhost:5173', pathname: '/' })).toEqual(['https://a.example', 'https://b.example'])
  })
})
