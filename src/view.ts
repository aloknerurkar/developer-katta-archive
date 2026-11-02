// Pure helpers behind App.tsx, kept out of the component so the browser-security rules can be unit-tested.
// Not a workshop module: attendees never edit this file.

// VITE_ARCHIVE_OWNER may come as 0x…, in mixed case or with stray spaces; keeperAddress() is bare lowercase hex.
export const normalizeAddress = (address: string) => address.trim().replace(/^0x/i, '').toLowerCase()

// Entries come from the network: what the browser may do with their bytes hangs on a type check that fails closed.
// SVG is the one image that carries script. A blob: URL has this app's origin, so "open image in new tab" would run
// the SVG next to the keeper key in localStorage. A data: URL has an opaque origin and top-level navigation to it is
// blocked, so SVG goes through one and is only ever shown in <img>. Other images and audio keep a blob: URL with the
// declared type; everything else is an octet-stream download and is never rendered.
export type Shown = { kind: 'svg' | 'image' | 'audio' | 'text' | 'download'; type: string }

export function shownAs(contentType: string): Shown {
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (type === 'image/svg+xml') return { kind: 'svg', type }
  if (/^image\/[a-z0-9][a-z0-9.+-]*$/.test(type)) return { kind: 'image', type }
  if (/^audio\/[a-z0-9][a-z0-9.+-]*$/.test(type)) return { kind: 'audio', type }
  if (type === 'text/plain') return { kind: 'text', type }
  return { kind: 'download', type: 'application/octet-stream' }
}

export function dataUrl(type: string, data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(binary)}`
}

// Which kind of URL a shown entry gets: SVG only ever a data: URL, text none, everything else a blob: URL.
export function urlKindFor(kind: Shown['kind']): 'data' | 'blob' | 'none' {
  if (kind === 'svg') return 'data'
  return kind === 'text' ? 'none' : 'blob'
}

// The log is the workshop's trust signal, and it is a <pre> joined with newlines. Titles, gateway answers and error
// messages are untrusted text: one with a line break in it could forge a "✓ … hash verified" line of its own. Every
// line is flattened to one line (control characters, DEL, NEL, LS and PS become a single space) and capped at 300
// characters. The bidirectional embeddings, overrides and isolates (U+202A-202E, U+2066-2069) go the same way: they
// cannot start a new line, but they can make the text on the screen differ from the text that was logged. The direction
// marks (LRM, RLM, ALM) are harmless and stay.
const MAX_LOG_LINE = 300
const LOG_UNSAFE = /[\u0000-\u001f\u007f\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g

export function sanitizeLogLine(line: string): string {
  const flat = line.replace(LOG_UNSAFE, ' ')
  if (flat.length <= MAX_LOG_LINE) return flat
  let cut = flat.slice(0, MAX_LOG_LINE - 1)
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1) // do not leave half a surrogate pair
  return `${cut}…`
}

// readFeedAnyPath reports a miss as `feed not found on any path (<url>: <reason>; <url>: <reason>)`, one reason per path
// in order. "Nothing to replace" is every path giving one of two reasons, and anything else is an archive we could not
// read, which is a different thing: that fails closed.
//
// 1. A stubbed workshop level. Until cp3 the feed code throws `TODO(cp3): see GUIDE.md, section cp3`: there is no
//    archive to read, publishing stops at the stubbed feed update anyway, and the deck's Checkpoint 1 (add an entry,
//    see ✓ entry published) has to work. The text is believed in its exact form only, and only from the feed lookup.
// 2. A node that says the feed has no update. bee-js writes `${statusText}: ${body}`, and fetch has no status text over
//    HTTP/2 and HTTP/3, so the reason is `Not Found: {…}` or `: {…}`. The body must be Bee's own JSON with code 404 and one
//    of the messages of Bee's pkg/api/feed.go that mean "no such feed": `no update found` (never updated) and
//    `lookup at failed` (the lookup ended without a chunk, which a fresh feed on a live network can do). Not
//    `wrapped chunk cannot be retrieved`: that is a feed that exists whose payload this node cannot fetch right now, and
//    publishing then would replace a real archive. Not a 404 from a proxy (HTML, an empty body, plain text) either:
//    it never reached a feed lookup, so it says nothing about the archive. A network error, a timeout, an abort and
//    any 5xx are unreadable too.
const STUB_REASON = /^TODO\((\w+)\): see GUIDE\.md, section \1$/
const BEE_NO_FEED_MESSAGES = new Set(['no update found', 'lookup at failed', 'lookup failed'])
const NO_FEED_PREFIX = 'feed not found on any path ('

function isNoFeedReason(reason: string): boolean {
  if (STUB_REASON.test(reason)) return true
  const answer = /^(?:Not Found)?: ([^]*)$/.exec(reason)
  if (!answer) return false
  try {
    const body: unknown = JSON.parse(answer[1])
    if (typeof body !== 'object' || body === null) return false
    const { code, message } = body as { code?: unknown; message?: unknown }
    return code === 404 && typeof message === 'string' && BEE_NO_FEED_MESSAGES.has(message)
  } catch {
    return false
  }
}

export function noFeedYet(message: string, urls: string[]): boolean {
  if (urls.length === 0 || !message.startsWith(NO_FEED_PREFIX) || !message.endsWith(')')) return false
  const body = message.slice(NO_FEED_PREFIX.length, -1)
  let at = 0
  for (let i = 0; i < urls.length; i++) {
    const head = `${urls[i]}: `
    if (!body.startsWith(head, at)) return false
    const from = at + head.length
    const last = i === urls.length - 1
    const end = last ? body.length : body.indexOf(`; ${urls[i + 1]}: `, from)
    if (end === -1 || !isNoFeedReason(body.slice(from, end))) return false
    at = last ? end : end + 2
  }
  return at === body.length
}

// How the first (or latest) attempt to read the archive went, as far as the Publish button is concerned.
export type LoadOutcome = { status: 'loading' } | { status: 'loaded' } | { status: 'failed'; message: string }

export interface PublishGate {
  canPublish: boolean
  hint: string | null // shown under the Publish button
  warning: string | null // logged once, for a keeper, when the archive could not be read
}

// An archive that could not be read looks empty, and publishing onto it would move the feed to a one-entry index. So the
// keeper may publish after a good load, or after a failure that proves there is nothing to replace (noFeedYet), and not
// while loading or after any other failure. App only calls this: the whole decision is here, where it can be tested.
export function publishGate(outcome: LoadOutcome, paths: string[]): PublishGate {
  if (outcome.status === 'loading') return { canPublish: false, hint: 'Checking the archive before you publish…', warning: null }
  if (outcome.status === 'loaded' || noFeedYet(outcome.message, paths)) return { canPublish: true, hint: null, warning: null }
  return {
    canPublish: false,
    hint: 'Publishing is off: the archive did not load. Reload it from Swarm first, or you would replace it.',
    warning: 'archive not loaded: reload before publishing, or you would replace it',
  }
}

// A failed "Copy keeper key" is logged, but the key itself must never reach the log, whatever the browser's message says.
export function copyFailureLine(reason: string, secret: string): string {
  return `copy failed: ${secret ? reason.split(secret).join('…') : reason}`
}

// The connection line under the title. Checkpoint 0 tells attendees to look for the green badge, so green means connected
// and nothing else: a failure takes the error style (.config-error, red), and the states with no verdict yet (still
// checking, or a read-only view with no connection to check) stay plain text. index.html owns the colours of both classes.
export type Health =
  | { status: 'checking' }
  | { status: 'readonly' }
  | { status: 'connected'; url: string }
  | { status: 'unreachable'; url: string; reason: string }

export function healthLine(health: Health): { text: string; className: 'health' | 'config-error' | undefined } {
  switch (health.status) {
    case 'checking':
      return { text: 'checking connection…', className: undefined }
    case 'readonly':
      return { text: 'read-only view of this archive', className: undefined }
    case 'connected':
      return { text: `connected to ${health.url}`, className: 'health' }
    case 'unreachable':
      return { text: `cannot reach ${health.url}: ${health.reason}`, className: 'config-error' }
  }
}
