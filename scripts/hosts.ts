import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Hosts that appear in bundles as namespaces or doc links, not runtime dependencies.
// bee-js 13.2.0 embeds json-schema.org (zod).
// The public gateway (api.gateway.ethswarm.org) is deliberately not here: bee-js's constant for it is tree-shaken out of the
// build, so any appearance means the app calls it, and a single non-Swarm-node dependency is what check 4 exists to catch.
// Never allow a host the app actually calls.
export const DEFAULT_ALLOW = ['localhost', '127.0.0.1', 'www.w3.org', 'json-schema.org', 'react.dev', 'reactjs.org']

export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase()
}

// Absolute urls, plus protocol-relative ones where a browser would load them: src=/href= attributes, url(...) and @import.
const ABSOLUTE = /\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi
const PROTOCOL_RELATIVE = /(?:\b(?:src|href)\s*=\s*|\burl\(\s*|@import\s*)["']?\/\/([a-z0-9.-]+)/gi

export function findExternalHosts(source: string, allow: string[]): string[] {
  const allowed = new Set(allow.map(h => h.toLowerCase()))
  const found = new Set<string>()
  for (const re of [ABSOLUTE, PROTOCOL_RELATIVE]) {
    for (const m of source.matchAll(re)) {
      const host = m[1].toLowerCase().replace(/\.$/, '')
      if (!allowed.has(host)) found.add(host)
    }
  }
  return [...found].sort()
}

function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? codeFiles(p) : /\.(?:js|mjs|css|html)$/.test(p) ? [p] : []
  })
}

// Every file in a built app that a browser loads as code or markup: .js, .mjs, .css and .html.
export function scanBundle(dir: string, allow: string[]): string[] {
  return findExternalHosts(codeFiles(dir).map(f => readFileSync(f, 'utf8')).join('\n'), allow)
}

// One url per origin, in order. A url that does not parse is kept as is, so it fails where it is used instead of here.
export function uniqueByOrigin(urls: string[]): string[] {
  const seen = new Set<string>()
  return urls.filter(url => {
    let key = url
    try {
      key = new URL(url).origin
    } catch {
      // not a url: its own key
    }
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
