import { readFileSync } from 'node:fs'
import { Bee } from '@ethersphere/bee-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyFailureLine, dataUrl, healthLine, noFeedYet, normalizeAddress, publishGate, sanitizeLogLine, shownAs, urlKindFor } from '../src/view'

const SVG = 'image/svg+xml'
const BIN = 'application/octet-stream'

// R14, the project's main browser-security rule: entries come from the network, and SVG is the one image that carries
// script. It may only ever be shown through a data: URL in <img>. Every table row below pins today's fail-closed behaviour.
describe('shownAs (R14)', () => {
  it.each([
    ['plain', 'image/svg+xml'],
    ['with a charset parameter', 'image/svg+xml; charset=utf-8'],
    ['upper case', 'IMAGE/SVG+XML'],
    ['mixed case with parameter', 'Image/Svg+Xml;charset=UTF-8'],
    ['trailing space', 'image/svg+xml '],
    ['trailing newline', 'image/svg+xml\n'],
    ['surrounding whitespace before a parameter', ' image/svg+xml ; charset=utf-8'],
    ['an empty parameter', 'image/svg+xml;'],
    ['a trailing no-break space (JS trim strips it)', 'image/svg+xml\u00a0'],
    ['a trailing line separator (JS trim strips it)', 'image/svg+xml\u2028'],
    ['a trailing BOM (JS trim strips it)', 'image/svg+xml\ufeff'],
  ])('shows %s (%j) as svg through a data: URL', (_why, contentType) => {
    expect(shownAs(contentType)).toEqual({ kind: 'svg', type: SVG })
  })

  it.each([
    ['a zero-width space', 'image/svg+xml\u200b'],
    ['a NUL', 'image/svg+xml\u0000'],
    ['a comma list', 'image/png, image/svg+xml'],
    ['a space list', 'image/png image/svg+xml'],
    ['a comma list, svg first', 'image/svg+xml,image/png'],
    ['a zero-width space before a parameter', 'image/svg+xml\u200b; charset=utf-8'],
    ['a line separator splice', 'image/png\u2028image/svg+xml'],
    ['a long s look-alike', 'image/\u017fvg+xml'],
  ])('downloads %s (%j) as an octet-stream, never renders it', (_why, contentType) => {
    expect(shownAs(contentType)).toEqual({ kind: 'download', type: BIN })
  })

  it.each([
    ['image/svg', 'image/svg'],
    ['image/svg+xml+xml', 'image/svg+xml+xml'],
    ['image/png', 'image/png'],
    ['image/x-svg+xml', 'image/x-svg+xml'],
    ['image/png;x=y', 'image/png'],
    ['image/\u212Avg', 'image/kvg'], // the Kelvin sign lower-cases to k: not svg
  ])('shows %s as an image, blob type %s', (contentType, type) => {
    expect(shownAs(contentType)).toEqual({ kind: 'image', type })
  })

  it('shows audio as audio and text/plain as text', () => {
    expect(shownAs('audio/mpeg')).toEqual({ kind: 'audio', type: 'audio/mpeg' })
    expect(shownAs('text/plain')).toEqual({ kind: 'text', type: 'text/plain' })
    expect(shownAs('text/plain;charset=utf-8')).toEqual({ kind: 'text', type: 'text/plain' })
  })

  it.each(['', 'image/', 'text/html', 'application/xhtml+xml', 'application/octet-stream', 'application/pdf', 'video/mp4', 'svg', 'x'.repeat(5000)])(
    'downloads anything else (%.30j)',
    contentType => {
      expect(shownAs(contentType)).toEqual({ kind: 'download', type: BIN })
    },
  )

  it('never gives a blob URL the svg type: svg is data: only, near-misses and lookalikes are not svg at all', () => {
    // Every unit of the alphabet below can sit around, inside or in place of the type; whatever comes out must keep the rule.
    const pieces = [SVG, 'image/svg', 'image/png', 'audio/mpeg', 'text/plain', ' ', '\n', '\t', '\r', '\u0000', '\u00a0', '\u200b', '\u2028', '\ufeff', ',', ';', ';x=y', '+xml', 'IMAGE/SVG+XML']
    const inputs = new Set<string>(pieces)
    for (const a of pieces) for (const b of pieces) inputs.add(a + b)
    for (const a of pieces) for (const b of pieces) for (const c of pieces) inputs.add(a + b + c)
    expect(inputs.size).toBeGreaterThan(3000)

    for (const contentType of inputs) {
      const shown = shownAs(contentType)
      if (shown.kind === 'svg') {
        expect(shown.type).toBe(SVG)
        expect(urlKindFor(shown.kind)).toBe('data')
      } else {
        // Only the svg kind may carry the svg type; every other kind gets a blob URL (or none) typed as something else.
        expect(shown.type).not.toBe(SVG)
        expect(urlKindFor(shown.kind)).not.toBe('data')
      }
      if (shown.kind === 'download') expect(shown.type).toBe(BIN)
      if (shown.kind === 'image') expect(shown.type).toMatch(/^image\/[a-z0-9][a-z0-9.+-]*$/)
      if (shown.kind === 'audio') expect(shown.type).toMatch(/^audio\/[a-z0-9][a-z0-9.+-]*$/)
    }
  })
})

describe('urlKindFor', () => {
  it('uses a data: URL for svg only, nothing for text, and a blob: URL for the rest', () => {
    expect(urlKindFor('svg')).toBe('data')
    expect(urlKindFor('text')).toBe('none')
    expect(urlKindFor('image')).toBe('blob')
    expect(urlKindFor('audio')).toBe('blob')
    expect(urlKindFor('download')).toBe('blob')
  })
})

describe('dataUrl', () => {
  it('builds a base64 data: URL with the given type', () => {
    expect(dataUrl(SVG, new TextEncoder().encode('<svg/>'))).toBe('data:image/svg+xml;base64,PHN2Zy8+')
    expect(dataUrl(SVG, new Uint8Array())).toBe('data:image/svg+xml;base64,')
  })

  it('round-trips bytes larger than one 0x8000 chunk, all 256 byte values included', () => {
    const data = new Uint8Array(0x8000 * 2 + 123).map((_, i) => i % 256)
    const url = dataUrl(SVG, data)
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const decoded = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0))
    expect(decoded).toEqual(data)
  })
})

describe('normalizeAddress', () => {
  it('gives bare lower-case hex whatever the spelling', () => {
    expect(normalizeAddress('0xAbCd')).toBe('abcd')
    expect(normalizeAddress('  0XABCD \n')).toBe('abcd')
    expect(normalizeAddress('abcd')).toBe('abcd')
  })
})

describe('sanitizeLogLine', () => {
  it('leaves normal text alone, non-ASCII included', () => {
    for (const line of [
      '✓ index ab12cd34… from https://gw.example/bzz, hash verified',
      '✗ https://dead.invalid: fetch failed',
      '✓ entry published: ' + 'ab'.repeat(32),
      'Ünïcödé → Ωmega · 日本語 ✓',
      '',
    ]) {
      expect(sanitizeLogLine(line)).toBe(line)
    }
  })

  it('cannot be used to forge a second log line', () => {
    const hostile = 'Nice song\n12:00:00  ✓ index ' + 'ab'.repeat(4) + '… from https://gw.example, hash verified'
    const out = sanitizeLogLine(`✓ ${hostile} from https://x, hash verified`)
    expect(out).not.toMatch(/[\r\n\u2028\u2029]/)
    expect(out).toBe('✓ Nice song 12:00:00  ✓ index abababab… from https://gw.example, hash verified from https://x, hash verified')
  })

  it.each([
    ['LF', 'a\nb'],
    ['CR', 'a\rb'],
    ['CRLF', 'a\r\nb'],
    ['NUL', 'a\u0000b'],
    ['tab', 'a\tb'],
    ['ESC', 'a\u001bb'],
    ['DEL', 'a\u007fb'],
    ['U+2028', 'a\u2028b'],
    ['U+2029', 'a\u2029b'],
    ['NEL (U+0085)', 'a\u0085b'],
    ['LRE (U+202A)', 'a\u202ab'],
    ['RLE (U+202B)', 'a\u202bb'],
    ['PDF (U+202C)', 'a\u202cb'],
    ['LRO (U+202D)', 'a\u202db'],
    ['RLO (U+202E)', 'a\u202eb'],
    ['LRI (U+2066)', 'a\u2066b'],
    ['RLI (U+2067)', 'a\u2067b'],
    ['FSI (U+2068)', 'a\u2068b'],
    ['PDI (U+2069)', 'a\u2069b'],
    ['a mixed run', 'a\r\n\u2028\u2029\t\u0000\u007f\u0085\u202e\u2066b'],
  ])('replaces %s, or a run of them, with a single space', (_name, line) => {
    expect(sanitizeLogLine(line)).toBe('a b')
  })

  it('does not let a right-to-left override reorder what the line shows', () => {
    // Without the override, the reversed forgery below would render as a plain "✓ index … hash verified" next to a ✗ line.
    const out = sanitizeLogLine('✗ https://gw: \u202e' + 'deifirev hsah ,ew.gw//:sptth morf 11ba… xedni ✓')
    expect(out).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/)
  })

  it('leaves the harmless direction marks and zero-width joiners alone', () => {
    for (const mark of ['\u200e', '\u200f', '\u061c', '\u200d']) expect(sanitizeLogLine(`a${mark}b`)).toBe(`a${mark}b`)
  })

  it('truncates to 300 characters, the last being …', () => {
    expect(sanitizeLogLine('x'.repeat(300))).toBe('x'.repeat(300))
    const cut = sanitizeLogLine('x'.repeat(301))
    expect(cut).toBe(`${'x'.repeat(299)}…`)
    expect(cut).toHaveLength(300)
    expect(sanitizeLogLine('x'.repeat(100_000))).toHaveLength(300)
  })

  it('collapses control runs before it measures, so they cannot eat the budget', () => {
    expect(sanitizeLogLine(`a${'\n'.repeat(1000)}b`)).toBe('a b')
  })

  it('does not leave half a surrogate pair at the cut', () => {
    const out = sanitizeLogLine(`${'x'.repeat(298)}😀tail`)
    expect(out).toBe(`${'x'.repeat(298)}…`)
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(sanitizeLogLine(`${'x'.repeat(297)}😀tail`)).toBe(`${'x'.repeat(297)}😀…`)
  })

  it('is idempotent and never emits a line break, whatever goes in', () => {
    const alphabet = ['a', 'Z', ' ', '\n', '\r', '\t', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029', '\u202e', '\u2066', '\u2069', '\u001f', '…', '✓', '😀', 'x'.repeat(40)]
    let seed = 12345
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
    for (let n = 0; n < 500; n++) {
      let line = ''
      for (let i = next() % 40; i > 0; i--) line += alphabet[next() % alphabet.length]
      const out = sanitizeLogLine(line)
      expect(out).not.toMatch(/[\u0000-\u001f\u007f\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069]/)
      expect(out.length).toBeLessThanOrEqual(300)
      expect(sanitizeLogLine(out)).toBe(out)
    }
  })
})

// The gating decision behind the Publish button: given how the archive load went, may the keeper publish, and what does
// the screen say. Publishing onto an archive that merely failed to load would move the feed to a one-entry index.
describe('publishGate', () => {
  const A = 'https://a.example'
  const B = 'http://127.0.0.1:1633'
  const stub = 'TODO(cp3): see GUIDE.md, section cp3'
  const bee = (message: string, code = 404) => JSON.stringify({ message, code })
  const wrap = (...reasons: string[]) => `feed not found on any path (${reasons.join('; ')})`
  // bee-js writes `${statusText}: ${body}`; fetch has no status text over HTTP/2 and HTTP/3, which is what browsers talk to a Caddy gateway.
  const h1 = (body: string) => `Not Found: ${body}`
  const h2 = (body: string) => `: ${body}`
  const failed = (message: string, paths = [A]) => publishGate({ status: 'failed', message }, paths)

  it('keeps Publish off while the first load is running, and says why', () => {
    const gate = publishGate({ status: 'loading' }, [A])
    expect(gate.canPublish).toBe(false)
    expect(gate.hint).toBe('Checking the archive before you publish…')
    expect(gate.warning).toBeNull()
  })

  it('turns Publish on, with no hint and no warning, after a good load', () => {
    expect(publishGate({ status: 'loaded' }, [A])).toEqual({ canPublish: true, hint: null, warning: null })
  })

  // C1: a stubbed workshop level means the feed code is not written yet, so there is nothing for a publish to clobber.
  // The deck's Checkpoint 1 ("Add an entry… look for ✓ entry published") has to work at cp0, cp1 and cp2.
  it.each([
    ['the cp3 stub, one path', wrap(`${A}: ${stub}`), [A]],
    ['the cp3 stub, two paths', wrap(`${A}: ${stub}`, `${B}: ${stub}`), [A, B]],
    ['a stub of another level', wrap(`${A}: TODO(l3): see GUIDE.md, section l3`), [A]],
  ])('lets the keeper publish on %s (nothing exists to replace)', (_why, message, paths) => {
    expect(failed(message, paths)).toEqual({ canPublish: true, hint: null, warning: null })
  })

  // Bee's /feeds answers 404 for four things (pkg/api/feed.go): the first two mean there is no feed to replace.
  it.each([
    ['no update found, status text', wrap(`${A}: ${h1(bee('no update found'))}`), true],
    ['no update found, no status text (HTTP/2)', wrap(`${A}: ${h2(bee('no update found'))}`), true],
    ['lookup at failed, status text', wrap(`${A}: ${h1(bee('lookup at failed'))}`), true],
    ['lookup at failed, no status text (HTTP/2)', wrap(`${A}: ${h2(bee('lookup at failed'))}`), true],
    ['the older "lookup failed"', wrap(`${A}: ${h1(bee('lookup failed'))}`), true],
    ['the key order of the repo fake gateway ({code, message})', wrap(`${A}: ${h1('{"code":404,"message":"no update found"}')}`), true],
    ['a trailing newline after the body', wrap(`${A}: ${h1(`${bee('no update found')}\n`)}`), true],
    // I1: the feed exists, its index chunk cannot be fetched right now. Publishing would replace a real archive.
    ['wrapped chunk cannot be retrieved, status text', wrap(`${A}: ${h1(bee('wrapped chunk cannot be retrieved'))}`), false],
    ['wrapped chunk cannot be retrieved, no status text (HTTP/2)', wrap(`${A}: ${h2(bee('wrapped chunk cannot be retrieved'))}`), false],
    ['wrapped chunk cannot be retrieved on one path, no update found on the other', wrap(`${A}: ${h1(bee('no update found'))}`, `${B}: ${h1(bee('wrapped chunk cannot be retrieved'))}`), false],
    ['a 404 message nobody recognises', wrap(`${A}: ${h1(bee('something new'))}`), false],
    ['the generic route 404 (the node has no /feeds route)', wrap(`${A}: ${h1(bee('Not Found'))}`), false],
  ])('on a Bee 404: %s', (_why, message, publish) => {
    const paths = message.includes(B) ? [A, B] : [A]
    const gate = failed(message, paths)
    expect(gate.canPublish).toBe(publish)
    expect(gate.hint === null).toBe(publish)
    expect(gate.warning === null).toBe(publish)
  })

  // A 404 that is not Bee's own JSON (nginx, Caddy, a CDN, a wrong base path) never reached a feed lookup, so it says
  // nothing about the archive: fail closed rather than let a misrouted path read as "empty".
  it.each([
    ['an nginx HTML 404', wrap(`${A}: ${h1('<html><body><h1>404 Not Found</h1>nginx</body></html>')}`)],
    ['an HTML 404 without status text', wrap(`${A}: ${h2('<html><body>404</body></html>')}`)],
    ['a proxy 404 with an empty body, status text', wrap(`${A}: Not Found`)],
    ['a proxy 404 with an empty body, no status text', wrap(`${A}: `)],
    ['a plain-text 404', wrap(`${A}: ${h1('page not found')}`)],
    ['JSON that is not a Bee answer', wrap(`${A}: ${h1('{"error":"no update found"}')}`)],
    ['broken JSON', wrap(`${A}: ${h1('{"message":"no update found","code":404')}`)],
    ['a 404 body in a non-404 answer', wrap(`${A}: Bad Gateway: ${bee('no update found')}`)],
    ['a body that carries code 502 but a Bee message', wrap(`${A}: ${h2(bee('no update found', 502))}`)],
  ])('fails closed on %s', (_why, message) => {
    expect(failed(message).canPublish).toBe(false)
  })

  // An archive we could not read looks empty: publishing then would replace it.
  it.each([
    ['connection refused', wrap(`${A}: fetch failed: connect ECONNREFUSED 127.0.0.1:1633`)],
    ['a browser network error', wrap(`${A}: Failed to fetch`)],
    ['a timeout', wrap(`${A}: The operation was aborted due to timeout`)],
    ['an abort', wrap(`${A}: Request aborted`)],
    ['a 5xx with status text', wrap(`${A}: Service Unavailable: ${bee('node is down', 503)}`)],
    ['a 5xx without status text (HTTP/2)', wrap(`${A}: ${h2(bee('node is down', 503))}`)],
    ['a 500 from Bee', wrap(`${A}: Internal Server Error: ${bee('new lookup failed', 500)}`)],
    ['a bad gateway page', wrap(`${A}: Bad Gateway: <html>bad</html>`)],
    ['a rate limit', wrap(`${A}: Too Many Requests: slow down`)],
    ['one path 404 and the other refused', wrap(`${A}: ${h1(bee('no update found'))}`, `${B}: fetch failed: connect ECONNREFUSED 127.0.0.1:1633`)],
    ['one path stubbed and the other refused', wrap(`${A}: ${stub}`, `${B}: Failed to fetch`)],
    ['a hash mismatch (an archive that is there)', 'hash mismatch: this path altered the content'],
    ['an index that does not parse', 'invalid index: no entries array'],
    ['the stub text from a path that already answered (raw, not from the feed lookup)', stub],
    ['an empty message', ''],
  ])('keeps Publish off on %s, with the hint and the warning', (_why, message) => {
    const paths = message.includes(B) ? [A, B] : [A]
    const gate = failed(message, paths)
    expect(gate.canPublish).toBe(false)
    expect(gate.hint).toBe('Publishing is off: the archive did not load. Reload it from Swarm first, or you would replace it.')
    expect(gate.warning).toBe('archive not loaded: reload before publishing, or you would replace it')
  })

  // The stub text is only believed in its exact form, from the feed lookup, so a node cannot use it as a pass.
  it.each([
    ['a status text before the stub text', wrap(`${A}: Bad Gateway: ${stub}`)],
    ['text after the stub text', wrap(`${A}: ${stub} and more`)],
    ['text before the stub text', wrap(`${A}: x ${stub}`)],
    ['a stub that names another section', wrap(`${A}: TODO(cp3): see GUIDE.md, section cp2`)],
    ['a stub without a level', wrap(`${A}: TODO(): see GUIDE.md, section `)],
    ['a lookalike without the GUIDE', wrap(`${A}: TODO(cp3): later`)],
  ])('does not take %s for a stub', (_why, message) => {
    expect(failed(message).canPublish).toBe(false)
  })

  it('does not line up a message with the wrong paths', () => {
    expect(failed(wrap(`${A}: ${stub}`), [B]).canPublish).toBe(false)
    expect(failed(wrap(`${A}: ${stub}`), [A, B]).canPublish).toBe(false)
    expect(failed(wrap(`${A}: ${stub}`, `${B}: ${stub}`), [A]).canPublish).toBe(false)
    expect(failed('feed not found on any path ()', []).canPublish).toBe(false)
    expect(failed(wrap(`${A}: ${stub}`), []).canPublish).toBe(false)
  })

  // The format is what bee-js 13.2.0 really produces, not what the table above assumes: drive the real client.
  describe('with the real bee-js client', () => {
    const owner = 'ab'.repeat(20)
    const topic = '00'.repeat(32)
    const urls = ['https://a.example', 'https://b.example']
    afterEach(() => vi.unstubAllGlobals())

    async function message(status: number, statusText: string, body: string, contentType = 'application/json; charset=utf-8'): Promise<string> {
      vi.stubGlobal('fetch', async () => new Response(body, { status, statusText, headers: { 'content-type': contentType } }))
      const reasons: string[] = []
      for (const url of urls) {
        try {
          await new Bee(url).feed.makeReader(topic, owner).downloadReference()
        } catch (err) {
          reasons.push(`${url}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return wrap(...reasons)
    }

    it.each([
      ['HTTP/1.1', 'Not Found'],
      ['HTTP/2 (browsers give an empty status text)', ''],
    ])('a fresh feed on every path lets the keeper publish over %s', async (_proto, statusText) => {
      const msg = await message(404, statusText, '{"message":"no update found","code":404}\n')
      expect(failed(msg, urls).canPublish).toBe(true)
    })

    it.each([
      ['HTTP/1.1', 'Not Found'],
      ['HTTP/2', ''],
    ])('an index chunk that cannot be fetched keeps Publish off over %s', async (_proto, statusText) => {
      const msg = await message(404, statusText, '{"message":"wrapped chunk cannot be retrieved","code":404}\n')
      expect(failed(msg, urls).canPublish).toBe(false)
    })

    it('a proxy HTML 404 keeps Publish off', async () => {
      const msg = await message(404, 'Not Found', '<html><body><h1>404 Not Found</h1></body></html>', 'text/html')
      expect(failed(msg, urls).canPublish).toBe(false)
    })

    it('a 503 keeps Publish off', async () => {
      const msg = await message(503, '', '{"message":"node is down","code":503}\n')
      expect(failed(msg, urls).canPublish).toBe(false)
    })
  })
})

describe('noFeedYet', () => {
  const A = 'https://a.example'
  const B = 'http://127.0.0.1:1633'
  const bee = '{"message":"no update found","code":404}'
  const wrap = (...reasons: string[]) => `feed not found on any path (${reasons.join('; ')})`

  it('is true when every path answered Bee 404, with or without a status text', () => {
    expect(noFeedYet(wrap(`${A}: Not Found: ${bee}`), [A])).toBe(true)
    expect(noFeedYet(wrap(`${A}: Not Found: ${bee}`, `${B}: Not Found: ${bee}`), [A, B])).toBe(true)
    expect(noFeedYet(wrap(`${A}: : ${bee}`, `${B}: Not Found: ${bee}`), [A, B])).toBe(true)
  })

  it('is false when any path failed some other way', () => {
    expect(noFeedYet(wrap(`${A}: Not Found: ${bee}`, `${B}: fetch failed: connect ECONNREFUSED 127.0.0.1:1633`), [A, B])).toBe(false)
    expect(noFeedYet(wrap(`${A}: Bad Gateway: <html>bad</html>`), [A])).toBe(false)
    expect(noFeedYet(wrap(`${A}: Service Unavailable: {"message":"node is down","code":503}`), [A])).toBe(false)
    expect(noFeedYet(wrap(`${A}: Request aborted`), [A])).toBe(false)
    expect(noFeedYet(wrap(`${A}: The operation was aborted due to timeout`), [A])).toBe(false)
  })

  it('is not fooled by a 404 mentioned in a failing answer', () => {
    expect(noFeedYet(wrap(`${A}: Bad Gateway: {"message":"upstream said Not Found","code":502}`), [A])).toBe(false)
    expect(noFeedYet(wrap(`${A}: Bad Gateway: {"message":"no update found","code":404}`), [A])).toBe(false)
  })

  it('is false for any other error, and when the message does not line up with the paths', () => {
    expect(noFeedYet('hash mismatch: this path altered the content', [A])).toBe(false)
    expect(noFeedYet('invalid index: no entries array', [A])).toBe(false)
    expect(noFeedYet('feed not found on any path ()', [])).toBe(false)
    expect(noFeedYet(wrap(`${A}: Not Found: ${bee}`), [B])).toBe(false)
    expect(noFeedYet(wrap(`${A}: Not Found: ${bee}`), [A, B])).toBe(false)
    expect(noFeedYet(wrap(`${A}: Not Found: ${bee}`, `${B}: Not Found: ${bee}`), [A])).toBe(false)
    expect(noFeedYet('', [A])).toBe(false)
  })
})

describe('copyFailureLine', () => {
  const key = 'ab'.repeat(32)

  it('names the failure', () => {
    expect(copyFailureLine('Write permission denied.', key)).toBe('copy failed: Write permission denied.')
  })

  it('never carries the key, even if a browser message did', () => {
    const line = copyFailureLine(`could not copy ${key} to the clipboard`, key)
    expect(line).not.toContain(key)
    expect(line).toBe('copy failed: could not copy … to the clipboard')
  })

  it('does not redact when the secret is empty', () => {
    expect(copyFailureLine('nope', '')).toBe('copy failed: nope')
  })
})

// M5: checkpoint 0 tells attendees to look for the green badge, so green must mean connected and nothing else.
describe('healthLine (M5)', () => {
  const url = 'https://w.example.org'

  it('is green only when connected', () => {
    expect(healthLine({ status: 'connected', url })).toEqual({ text: `connected to ${url}`, className: 'health' })
  })

  it('shows a failure in the error style, never green, with the reason', () => {
    const line = healthLine({ status: 'unreachable', url, reason: 'Failed to fetch' })
    expect(line.text).toBe(`cannot reach ${url}: Failed to fetch`)
    expect(line.className).toBe('config-error')
  })

  it.each([
    ['still checking', { status: 'checking' } as const, 'checking connection…'],
    ['a read-only view, where there is no connection to check', { status: 'readonly' } as const, 'read-only view of this archive'],
  ])('is plain text, neither green nor red, while %s', (_why, health, text) => {
    expect(healthLine(health)).toEqual({ text, className: undefined })
  })

  it('never gives a "cannot reach" line the green class', () => {
    for (const reason of ['', 'Failed to fetch', 'The operation timed out.', 'connected to x']) {
      const line = healthLine({ status: 'unreachable', url, reason })
      expect(line.text.startsWith('cannot reach')).toBe(true)
      expect(line.className).not.toBe('health')
    }
  })

  // The classes are styled in index.html, which this helper does not own: pin the colours it relies on.
  it('relies on index.html colouring .health green (--ok) and .config-error red (--bad)', () => {
    const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(css).toMatch(/--ok:\s*#4ade80/)
    expect(css).toMatch(/--bad:\s*#ff6b6b/)
    expect(css).toMatch(/\.health\b[^{}]*\{\s*color:\s*var\(--ok\)/)
    expect(css).toMatch(/\.config-error\s*\{\s*color:\s*var\(--bad\)/)
  })
})
