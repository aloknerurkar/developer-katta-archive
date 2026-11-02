import { build } from 'vite'
import { loadConfig } from '../src/config'
import { makeBee } from '../src/swarm/clients'
import { INDEX_TOPIC } from '../src/swarm/feed'
import { fetchVerified } from '../src/swarm/reader'
import { parseIndex } from '../src/swarm/types'
import { DEFAULT_ALLOW, hostOf, scanBundle, uniqueByOrigin } from './hosts'

type Outcome = 'PASS' | 'FAIL' | 'SKIP'
const checks: { name: string; outcome: Outcome; detail: string }[] = []
const record = (name: string, outcome: Outcome, detail: string) => checks.push({ name, outcome, detail })

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

const config = loadConfig(process.env)
const site = arg('site')
const owner = arg('owner') ?? config.archiveOwner
const liar = arg('liar')

// 1. The app loads from its Swarm reference through at least two independent paths.
//    Paths count by origin: the same node listed twice is one path.
const readPaths = uniqueByOrigin(config.readUrls)
if (!site) {
  record('1 app via 2+ paths', 'SKIP', 'pass --site <site manifest reference>')
} else if (readPaths.length < 2) {
  record('1 app via 2+ paths', 'FAIL', `VITE_READ_URLS has ${readPaths.length} distinct origin(s), need 2+: ${readPaths.join(', ')}`)
} else {
  const ok: string[] = []
  for (const url of readPaths) {
    try {
      const r = await fetch(`${url}/bzz/${site}/`, { signal: AbortSignal.timeout(20_000) })
      if (r.ok && (r.headers.get('content-type') ?? '').includes('text/html')) ok.push(url)
    } catch {
      // unreachable path: counted as not serving
    }
  }
  record('1 app via 2+ paths', ok.length >= 2 ? 'PASS' : 'FAIL', `served by ${ok.length}/${readPaths.length}: ${ok.join(', ') || 'none'}`)
}

// 2. Content updates through the feed without a redeploy (at least two index updates).
let firstEntry: string | null = null
if (!owner) {
  record('2 feed updates', 'SKIP', 'pass --owner <keeper address>')
} else {
  let detail = 'feed not found on any read path'
  let outcome: Outcome = 'FAIL'
  for (const url of config.readUrls) {
    try {
      const { reference, feedIndex } = await makeBee(url).feed.makeReader(INDEX_TOPIC, owner).downloadReference()
      const index = parseIndex((await fetchVerified(config.readUrls, reference.toHex())).data)
      firstEntry = index.entries[0]?.reference ?? null
      const updates = feedIndex.toBigInt() + 1n
      outcome = updates >= 2n && index.entries.length > 0 ? 'PASS' : 'FAIL'
      detail = `${updates} index updates, ${index.entries.length} entries (read via ${url})`
      break
    } catch (err) {
      detail = `${url}: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  record('2 feed updates', outcome, detail)
}

// 3. The reader rejects tampered bytes from the lying gateway (uses this repo's own reader).
//    Only a recorded 'hash mismatch' counts: a liar that is down or answers honestly proves nothing.
if (!liar || !firstEntry) {
  record('3 rejects tampering', 'SKIP', liar ? 'no entry to test with' : 'pass --liar <lying gateway url>')
} else {
  try {
    const result = await fetchVerified([liar, ...config.readUrls], firstEntry)
    const liarFailure = result.failures.find(f => f.url === liar)
    if (result.url !== liar && liarFailure?.reason.startsWith('hash mismatch')) {
      record('3 rejects tampering', 'PASS', `liar rejected (${liarFailure.reason}), served by ${result.url}`)
    } else {
      record('3 rejects tampering', 'FAIL', `liar unreachable or not tampering: ${liarFailure?.reason ?? 'it served the entry unaltered'}`)
    }
  } catch (err) {
    record('3 rejects tampering', 'FAIL', err instanceof Error ? err.message : String(err))
  }
}

// 4. The built bundle (js, mjs, css and html) has no single non-Swarm runtime host.
//    A build or url failure is this check's FAIL; it must not discard the results of checks 1-3.
try {
  await build({ base: './', logLevel: 'error' })
  const nodes = [config.writeUrl, ...config.readUrls, ...(config.adoptUrl ? [config.adoptUrl] : [])]
  const nodeHost = (url: string) => {
    try {
      return hostOf(url)
    } catch {
      throw new Error(`not a url: ${url} (include https://)`)
    }
  }
  const hosts = scanBundle('dist', [...DEFAULT_ALLOW, ...nodes.map(nodeHost)])
  record('4 no single host', hosts.length === 0 ? 'PASS' : 'FAIL', hosts.length === 0 ? 'bundle references only Swarm paths' : `bundle references: ${hosts.join(', ')}`)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  record('4 no single host', 'FAIL', `could not scan the bundle: ${message.split('\n')[0]}`)
}

for (const c of checks) console.log(`${c.outcome.padEnd(4)}  ${c.name.padEnd(22)}  ${c.detail}`)
const count = (outcome: Outcome) => checks.filter(c => c.outcome === outcome).length
// A run with flags missing is partial: say so, since SKIP is neither a pass nor a failure.
console.log(`${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIP')} skipped`)
// Exit code: the number of FAILs (0 when every check passed or was skipped, up to 4), as before.
process.exitCode = count('FAIL')
