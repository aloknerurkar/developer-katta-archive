import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ALLOW, findExternalHosts, hostOf, scanBundle, uniqueByOrigin } from '../scripts/hosts'

describe('findExternalHosts', () => {
  it('lists hosts that are not on the allowlist, sorted and unique', () => {
    const src = 'fetch("https://api.example.com/x");fetch("https://api.example.com/y");const s="wss://relay.example.org/gun";const n="http://www.w3.org/2000/svg"'
    expect(findExternalHosts(src, DEFAULT_ALLOW)).toEqual(['api.example.com', 'relay.example.org'])
  })

  it('treats configured node hosts as allowed', () => {
    const src = 'const a="https://a.katta.example.org";const b="https://b.katta.example.org/bzz/x"'
    expect(findExternalHosts(src, [...DEFAULT_ALLOW, 'a.katta.example.org', 'b.katta.example.org'])).toEqual([])
  })

  it('extracts a lowercase hostname from a url', () => {
    expect(hostOf('https://A.Example.org:8443/path')).toBe('a.example.org')
  })

  it('flags a web font linked from index.html', () => {
    const html = '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>'
    expect(findExternalHosts(html, DEFAULT_ALLOW)).toEqual(['fonts.googleapis.com'])
  })

  it('flags a protocol-relative script in html', () => {
    const html = '<body><script src="//cdn.example.com/x.js"></script></body>'
    expect(findExternalHosts(html, DEFAULT_ALLOW)).toEqual(['cdn.example.com'])
  })

  it('flags protocol-relative hosts in css, quoted or not', () => {
    const css = 'a{background:url(//img.example.com/a.png)}b{background:url( "//img2.example.com/b.png" )}@import "//fonts.example.net/a.css";@import url(//fonts.example.org/b.css)'
    expect(findExternalHosts(css, DEFAULT_ALLOW)).toEqual(['fonts.example.net', 'fonts.example.org', 'img.example.com', 'img2.example.com'])
  })

  it('does not flag relative paths, comments or an allowed protocol-relative host', () => {
    const src = '<link href="./assets/a.css"><script src="/x.js"></script><script src="//localhost:5173/y.js"></script>\n// a comment\nconst r = a//b'
    expect(findExternalHosts(src, DEFAULT_ALLOW)).toEqual([])
  })

  it('flags a bundle that calls the public gateway', () => {
    expect(findExternalHosts('new Bee("https://api.gateway.ethswarm.org")', DEFAULT_ALLOW)).toEqual(['api.gateway.ethswarm.org'])
  })
})

describe('scanBundle', () => {
  const dirs: string[] = []
  const bundle = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'))
    dirs.push(dir)
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), text)
    }
    return dir
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('scans js, mjs, css and html files, nested', () => {
    const dir = bundle({
      'index.html': '<link href="https://fonts.googleapis.com/css2?family=Inter">',
      'assets/app.js': 'fetch("https://js.example.com")',
      'assets/chunk.mjs': 'fetch("https://mjs.example.com")',
      'assets/app.css': 'a{background:url(//css.example.com/a.png)}',
    })
    expect(scanBundle(dir, DEFAULT_ALLOW)).toEqual(['css.example.com', 'fonts.googleapis.com', 'js.example.com', 'mjs.example.com'])
  })

  it('ignores files that are not code, and is clean when only allowed hosts appear', () => {
    const dir = bundle({
      'index.html': '<script type="module" src="./assets/app.js"></script>',
      'assets/app.js': 'const ns="http://www.w3.org/2000/svg"',
      'assets/app.js.map': '"https://maps.example.com"',
      'logo.svg': '<svg xmlns="http://svg.example.com"/>',
    })
    expect(scanBundle(dir, DEFAULT_ALLOW)).toEqual([])
  })
})

describe('uniqueByOrigin', () => {
  it('keeps one url per origin, in order', () => {
    expect(uniqueByOrigin(['http://127.0.0.1:1633', 'http://127.0.0.1:1633', 'https://b.example.org', 'HTTPS://B.example.org:443/bzz'])).toEqual(['http://127.0.0.1:1633', 'https://b.example.org'])
  })

  it('keeps a url that does not parse, so the caller can see it fail', () => {
    expect(uniqueByOrigin(['not a url', 'https://a.example.org'])).toEqual(['not a url', 'https://a.example.org'])
  })
})
