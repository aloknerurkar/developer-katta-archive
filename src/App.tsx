import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Bee, PrivateKey } from '@ethersphere/bee-js'
import { readPaths, servingNode, type AppConfig } from './config'
import { makeBee } from './swarm/clients'
import { INDEX_TOPIC, keeperAddress, loadOrCreateKeeperKey, publishToFeed, readFeedAnyPath } from './swarm/feed'
import { adopt, batchStatus, isRetrievable, pinOn } from './swarm/keepalive'
import { publishEntry, publishIndex } from './swarm/publish'
import { fetchVerified, type PathFailure } from './swarm/reader'
import { loadStamper, saveStamper, uploadSelfStamped } from './swarm/stamper'
import { MAX_FIELD, addEntry, emptyIndex, parseIndex, serializeIndex, type ArchiveEntry, type ArchiveIndex } from './swarm/types'
import { copyFailureLine, dataUrl, healthLine, normalizeAddress, publishGate, sanitizeLogLine, shownAs, urlKindFor, type Health, type LoadOutcome, type PublishGate, type Shown } from './view'

type Note = (line: string) => void

const HEX64 = /^[0-9a-fA-F]{64}$/
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const short = (ref: string) => `${ref.slice(0, 8)}…`

// The same file can be published twice (same reference), so a reference alone is not a unique React key.
function entryKeys(entries: ArchiveEntry[]): string[] {
  const seen = new Map<string, number>()
  return entries.map(e => {
    const n = seen.get(e.reference) ?? 0
    seen.set(e.reference, n + 1)
    return `${e.reference}#${n}`
  })
}

export function App({ config }: { config: AppConfig }) {
  const [paths] = useState(() => readPaths(config, window.location))
  // makeBee's deadline is real per request, and an upload only answers once the push has finished: give writes room.
  const [writer] = useState(() => makeBee(config.writeUrl, 120_000))
  // The quick check (batch status) uses the 15 s default: with the 120 s writer a dead W shows nothing for 2 minutes.
  const [checker] = useState(() => makeBee(config.writeUrl))
  // "Still retrievable?" asks W to walk every chunk of the entry before it answers, so a big entry needs more than 15 s.
  const [retriever] = useState(() => makeBee(config.writeUrl, 60_000))
  // Every app deployed on a gateway shares that gateway's origin, and so its localStorage: a deployed read-only copy
  // (served from /bzz/, owner baked in) must not create a keeper key there. `npm run dev` is unchanged.
  const [keeper] = useState(() => {
    if (servingNode(window.location) !== null && config.archiveOwner !== null) return null
    const key = loadOrCreateKeeperKey(window.localStorage)
    return { key, address: keeperAddress(key) }
  })
  const owner = normalizeAddress(config.archiveOwner ?? keeper?.address ?? '')
  const isKeeper = keeper !== null && owner === normalizeAddress(keeper.address)
  const [health, setHealth] = useState<Health>({ status: 'checking' })
  const [index, setIndex] = useState<ArchiveIndex>(() => emptyIndex('Our community archive'))
  // An archive that could not be read looks empty, and publishing onto it would move the feed to a one-entry index.
  // How the latest load went decides whether the keeper may publish (publishGate, in view.ts, owns that decision).
  const [load, setLoad] = useState<LoadOutcome>({ status: 'loading' })
  const gate = publishGate(load, paths)
  const [log, setLog] = useState<string[]>([])

  // Titles, gateway answers and error text are untrusted: every line is flattened and capped before it joins the log.
  const note: Note = useCallback(line => setLog(l => [`${new Date().toLocaleTimeString()}  ${sanitizeLogLine(line)}`, ...l].slice(0, 60)), [])
  const noteFailures = useCallback((failures: PathFailure[]) => failures.forEach(f => note(`✗ ${f.url}: ${f.reason}`)), [note])

  useEffect(() => {
    if (!isKeeper) {
      setHealth({ status: 'readonly' })
      return
    }
    makeBee(config.writeUrl).status.getHealth().then(
      () => setHealth({ status: 'connected', url: config.writeUrl }),
      err => setHealth({ status: 'unreachable', url: config.writeUrl, reason: errorText(err) }),
    )
  }, [config.writeUrl, isKeeper])

  const loadArchive = useCallback(async () => {
    try {
      const ref = await readFeedAnyPath(paths, owner, INDEX_TOPIC)
      const result = await fetchVerified(paths, ref)
      noteFailures(result.failures)
      setIndex(parseIndex(result.data))
      note(`✓ index ${short(ref)} from ${result.url}, hash verified`)
      setLoad({ status: 'loaded' })
    } catch (err) {
      const outcome: LoadOutcome = { status: 'failed', message: errorText(err) }
      note(`index not loaded: ${outcome.message}`)
      setLoad(outcome)
      const { warning } = publishGate(outcome, paths)
      if (warning && isKeeper) note(warning)
    }
  }, [paths, owner, isKeeper, note, noteFailures])

  useEffect(() => {
    void loadArchive()
  }, [loadArchive])

  const keys = entryKeys(index.entries)
  const healthView = healthLine(health)

  return (
    <main>
      <header>
        <h1>{index.name}</h1>
        <p className={healthView.className}>{healthView.text}</p>
        <p className="mono">keeper {owner}{isKeeper ? ' (you)' : ''}</p>
        <p className="mono">read paths: {paths.join(' → ')}</p>
      </header>
      {keeper && isKeeper && <PublishForm config={config} writer={writer} index={index} onIndex={setIndex} keeperKey={keeper.key} gate={gate} note={note} />}
      <section>
        <h2>Archive</h2>
        <button onClick={() => void loadArchive()}>Reload from Swarm</button>
        {index.entries.length === 0 && <p>No entries yet.</p>}
        {index.entries.map((entry, i) => (
          <EntryCard key={keys[i]} entry={entry} paths={paths} retriever={retriever} note={note} noteFailures={noteFailures} />
        ))}
      </section>
      <KeepAlive config={config} checker={checker} note={note} />
      {keeper && isKeeper && <KeeperKey keyHex={keeper.key.toHex()} note={note} />}
      <section>
        <h2>Log</h2>
        <pre className="log">{log.join('\n')}</pre>
      </section>
    </main>
  )
}

// L4: the team batch's stamping key lives in this browser only (localStorage), never in a VITE_* variable.
const TEAM_BATCH = 'katta.team.batchId'
const TEAM_DEPTH = 'katta.team.depth'
const TEAM_KEY = 'katta.team.key'

interface TeamForm {
  batchId: string
  depth: string
  key: string
  enabled: boolean
}

interface TeamStamps {
  batchId: string
  depth: number
  key: string
}

function readTeamForm(store: Storage): TeamForm {
  return {
    batchId: store.getItem(TEAM_BATCH) ?? '',
    depth: store.getItem(TEAM_DEPTH) ?? '',
    key: store.getItem(TEAM_KEY) ?? '',
    enabled: false,
  }
}

function saveTeamForm(store: Storage, form: TeamForm): void {
  store.setItem(TEAM_BATCH, form.batchId)
  store.setItem(TEAM_DEPTH, form.depth)
  store.setItem(TEAM_KEY, form.key)
}

// Only when the box is ticked and all three values are usable. The batch ID is lower-cased: the stamper's saved bucket
// state is keyed by it, and one batch under two spellings would hand out the same slots twice.
function teamStamps(form: TeamForm): TeamStamps | null {
  if (!form.enabled || !HEX64.test(form.batchId) || !HEX64.test(form.key) || !/^\d+$/.test(form.depth.trim())) return null
  const depth = Number(form.depth)
  if (depth < 17 || depth > 255) return null
  return { batchId: form.batchId.toLowerCase(), depth, key: form.key.toLowerCase() }
}

function PublishForm(props: {
  config: AppConfig
  writer: Bee
  index: ArchiveIndex
  onIndex: (i: ArchiveIndex) => void
  keeperKey: PrivateKey
  gate: PublishGate
  note: Note
}) {
  const { config, writer, index, onIndex, keeperKey, gate, note } = props
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState({ title: '', language: '', region: '', contributor: '' })
  const [busy, setBusy] = useState(false)
  const [teamForm, setTeamForm] = useState(() => readTeamForm(window.localStorage))
  const team = teamStamps(teamForm)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || !gate.canPublish) return
    setBusy(true)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      // With team stamps the browser stamps every chunk itself and pushes it to read node A; the shared batch on W is not used.
      let putStamped: ((bytes: Uint8Array) => Promise<string>) | null = null
      if (team) {
        const node = config.readUrls[0]
        if (!node) throw new Error('VITE_READ_URLS has no node to upload to')
        const stamper = loadStamper(window.localStorage, team.key, team.batchId, team.depth)
        const bee = makeBee(node, 30_000)
        putStamped = bytes => uploadSelfStamped(bee, stamper, bytes, () => saveStamper(window.localStorage, team.batchId, stamper))
        note(`stamping with team batch ${short(team.batchId)}, uploading via ${node}`)
      }
      const entryMeta = { ...meta, contentType: file.type || 'application/octet-stream', date: new Date().toISOString().slice(0, 10) }
      const entry: ArchiveEntry = putStamped
        ? { ...entryMeta, reference: await putStamped(data) }
        : await publishEntry(writer, config.batchId, data, entryMeta)
      note(`✓ entry published: ${entry.reference}`)
      const next = addEntry(index, entry)
      let indexRef: string
      if (putStamped) {
        const bytes = serializeIndex(next)
        parseIndex(bytes) // same guard as publishIndex: never publish an index every reader would reject
        indexRef = await putStamped(bytes)
      } else {
        indexRef = await publishIndex(writer, config.batchId, next)
      }
      note(`✓ index published: ${indexRef}`)
      await publishToFeed(writer, config.batchId, keeperKey, INDEX_TOPIC, indexRef)
      note('✓ feed updated: the same archive URL now shows this entry')
      onIndex(next) // only now: the screen never shows an entry the feed does not point to
    } catch (err) {
      note(`publish stopped: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const field = (name: keyof typeof meta) => (
    <label>
      {name}
      <input value={meta[name]} maxLength={MAX_FIELD} required onChange={e => setMeta({ ...meta, [name]: e.target.value })} />
    </label>
  )

  function changeTeam(patch: Partial<TeamForm>) {
    const next = { ...teamForm, ...patch }
    setTeamForm(next)
    saveTeamForm(window.localStorage, next)
  }

  return (
    <>
      <section>
        <h2>Add an entry</h2>
        <form onSubmit={e => void submit(e)}>
          <input type="file" required onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div>
            {field('title')}
            {field('language')}
            {field('region')}
            {field('contributor')}
          </div>
          <button disabled={busy || !gate.canPublish}>{busy ? 'Publishing…' : 'Publish to Swarm'}</button>
          {gate.hint && <p>{gate.hint}</p>}
        </form>
      </section>
      <section>
        <h2>L4: publish with our team stamps</h2>
        <div>
          <label style={{ marginRight: 12 }}>
            team batch ID (64 hex)
            <input value={teamForm.batchId} onChange={e => changeTeam({ batchId: e.target.value.trim() })} spellCheck={false} />
          </label>
          <label style={{ marginRight: 12 }}>
            batch depth
            <input type="number" min={17} max={255} value={teamForm.depth} onChange={e => changeTeam({ depth: e.target.value })} />
          </label>
          <label>
            stamping key (64 hex)
            <input type="password" autoComplete="off" value={teamForm.key} onChange={e => changeTeam({ key: e.target.value.trim() })} spellCheck={false} />
          </label>
        </div>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={teamForm.enabled} onChange={e => changeTeam({ enabled: e.target.checked })} />
          use team stamps
        </label>
        {teamForm.enabled && !team && <p>Team stamps stay off until the batch ID, depth (17 or more) and key are all valid.</p>}
        <p style={{ color: 'var(--muted)' }}>
          Entries and the index are stamped in this browser and pushed to the first read node. The feed update still goes through node W with the shared
          batch: stamping the feed yourself is out of scope.
        </p>
      </section>
    </>
  )
}

interface View {
  kind: Shown['kind']
  servedBy: string
  url?: string // data: for SVG, blob: for the rest; none for plain text
  text?: string
}

function EntryCard(props: { entry: ArchiveEntry; paths: string[]; retriever: Bee; note: Note; noteFailures: (f: PathFailure[]) => void }) {
  const { entry, paths, retriever, note, noteFailures } = props
  const [view, setView] = useState<View | null>(null)
  const [retrievable, setRetrievable] = useState('')

  useEffect(() => () => {
    if (view?.url?.startsWith('blob:')) URL.revokeObjectURL(view.url)
  }, [view])

  async function load() {
    try {
      const result = await fetchVerified(paths, entry.reference)
      noteFailures(result.failures)
      const shown = shownAs(entry.contentType)
      const urlKind = urlKindFor(shown.kind)
      let url: string | undefined
      if (urlKind === 'data') url = dataUrl(shown.type, result.data)
      else if (urlKind === 'blob') url = URL.createObjectURL(new Blob([new Uint8Array(result.data)], { type: shown.type }))
      const text = shown.kind === 'text' ? new TextDecoder().decode(result.data) : undefined
      setView({ kind: shown.kind, servedBy: result.url, url, text })
      note(`✓ ${entry.title} from ${result.url}, hash verified`)
    } catch (err) {
      note(`${entry.title}: ${errorText(err)}`)
    }
  }

  async function check() {
    note('checking retrievability…') // the node walks every chunk of the entry: a large one takes a while
    setRetrievable('checking…')
    try {
      setRetrievable((await isRetrievable(retriever, entry.reference)) ? 'retrievable ✓' : 'NOT retrievable ✗')
    } catch (err) {
      setRetrievable(errorText(err))
    }
  }

  return (
    <article>
      <h3>{entry.title}</h3>
      <p>{entry.language} · {entry.region} · {entry.contributor} · {entry.date}</p>
      <p className="mono">{entry.reference}</p>
      <button onClick={() => void load()}>Load (verified)</button>
      <button onClick={() => void check()}>Still retrievable?</button> <span>{retrievable}</span>
      {view && <p className="served">served by {view.servedBy} · hash verified ✓</p>}
      {view?.url && (view.kind === 'svg' || view.kind === 'image') && <img src={view.url} alt={entry.title} />}
      {view?.url && view.kind === 'audio' && <audio controls src={view.url} />}
      {view?.text !== undefined && <pre>{view.text}</pre>}
      {view?.url && view.kind === 'download' && <a href={view.url} download={`${entry.reference.slice(0, 8)}.bin`}>download</a>}
    </article>
  )
}

function KeepAlive({ config, checker, note }: { config: AppConfig; checker: Bee; note: Note }) {
  const [status, setStatus] = useState('')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const adopter = useMemo(() => (config.adoptUrl ? makeBee(config.adoptUrl, 120_000) : null), [config.adoptUrl])
  const validRef = /^[0-9a-f]{64}$/.test(ref)

  async function checkBatch() {
    try {
      const s = await batchStatus(checker, config.batchId)
      setStatus(`${s.usable ? 'usable' : 'NOT usable'} · ${s.ttlDays} days left · ${s.usagePercent}% full`)
    } catch (err) {
      setStatus(errorText(err))
    }
  }

  // An index only lists its entries: keeping the archive alive means keeping the index and every entry. A reference
  // that is not an index (or cannot be fetched) is applied alone. One failing reference is logged and the loop goes on.
  async function applyToArchive(verb: 'pin' | 're-upload', done: string, where: string, action: (reference: string) => Promise<void>) {
    setBusy(true)
    try {
      let refs = [ref]
      let isIndex = false
      try {
        const { data } = await fetchVerified(config.readUrls, ref)
        try {
          refs = [...new Set([ref, ...parseIndex(data).entries.map(e => e.reference)])]
          isIndex = true
        } catch {
          // verified bytes that are not an index: a plain reference
        }
      } catch (err) {
        note(`${verb}: could not read ${short(ref)} to list its entries, so only that reference is handled (${errorText(err)})`)
      }
      let ok = 0
      for (const r of refs) {
        try {
          await action(r)
          ok++
        } catch (err) {
          note(`${verb} ${r}: ${errorText(err)}`)
        }
      }
      if (!isIndex) {
        if (ok === 1) note(`✓ ${done} ${short(ref)} ${where}`)
      } else if (ok === refs.length) {
        note(`✓ ${done} index + ${refs.length - 1} entries ${where}`)
      } else {
        note(`${verb}: ${ok} of ${refs.length} references (index + entries) ${done} ${where}; ${refs.length - ok} failed, see above`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function pin() {
    if (!adopter) return
    await applyToArchive('pin', 'pinned', `on ${config.adoptUrl}`, r => pinOn(adopter, r))
  }

  async function reupload() {
    if (!adopter || !config.adoptBatchId) return
    const batchId = config.adoptBatchId
    await applyToArchive('re-upload', 're-uploaded', `with ${config.adoptUrl}'s batch`, r => adopt(adopter, batchId, r))
  }

  return (
    <section>
      <h2>Keep it alive</h2>
      <button onClick={() => void checkBatch()}>Check our postage batch</button> <span>{status}</span>
      {adopter && (
        <div>
          <input placeholder="reference to adopt (64 hex)" value={ref} onChange={e => setRef(e.target.value.trim().toLowerCase())} />
          <button disabled={!validRef || busy} onClick={() => void pin()}>Pin on {config.adoptUrl}</button>
          {config.adoptBatchId && (
            <button disabled={!validRef || busy} onClick={() => void reupload()}>Re-upload with its batch</button>
          )}
        </div>
      )}
    </section>
  )
}

function KeeperKey({ keyHex, note }: { keyHex: string; note: Note }) {
  const [copied, setCopied] = useState(false)

  // navigator.clipboard only exists in secure contexts (https, localhost), and writeText rejects when the browser refuses.
  // Say so in the log, but never put the key there.
  async function copy() {
    if (!navigator.clipboard) {
      note('copy failed: clipboard unavailable (use localhost or https)')
      return
    }
    try {
      await navigator.clipboard.writeText(keyHex)
      setCopied(true)
    } catch (err) {
      note(copyFailureLine(errorText(err), keyHex))
    }
  }

  return (
    <section>
      <h2>Keeper key</h2>
      <p>
        This key is your archive's identity: whoever holds it can update the feed. It lives only in this browser. Copy it into
        .env as KEEPER_KEY before npm run deploy, and never commit it.
      </p>
      <button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy keeper key'}</button>
    </section>
  )
}
