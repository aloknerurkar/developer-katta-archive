export interface ArchiveEntry {
  reference: string
  contentType: string
  title: string
  language: string
  region: string
  contributor: string
  date: string
}

export interface ArchiveIndex {
  version: 1
  name: string
  entries: ArchiveEntry[]
}

export const MAX_FIELD = 200
export const MAX_ENTRIES = 1000
const REFERENCE = /^[0-9a-f]{64}$/

export class InvalidIndexError extends Error {}

function text(o: Record<string, unknown>, key: string): string {
  const v = o[key]
  if (typeof v !== 'string' || v.length > MAX_FIELD) {
    throw new InvalidIndexError(`${key} must be a string of at most ${MAX_FIELD} characters`)
  }
  return v
}

function object(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new InvalidIndexError(`${what} must be an object`)
  return v as Record<string, unknown>
}

// The index comes from the network, so every field is checked before use.
export function parseIndex(bytes: Uint8Array): ArchiveIndex {
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new InvalidIndexError('index is not valid JSON')
  }
  const o = object(raw, 'index')
  if (o.version !== 1) throw new InvalidIndexError('unsupported index version')
  const name = text(o, 'name')
  if (!Array.isArray(o.entries) || o.entries.length > MAX_ENTRIES) {
    throw new InvalidIndexError(`entries must be an array of at most ${MAX_ENTRIES} items`)
  }
  const entries = o.entries.map((item: unknown) => {
    const e = object(item, 'entry')
    const reference = text(e, 'reference').toLowerCase()
    if (!REFERENCE.test(reference)) throw new InvalidIndexError('reference must be 64 hex characters')
    return {
      reference,
      contentType: text(e, 'contentType'),
      title: text(e, 'title'),
      language: text(e, 'language'),
      region: text(e, 'region'),
      contributor: text(e, 'contributor'),
      date: text(e, 'date'),
    }
  })
  return { version: 1, name, entries }
}

export function serializeIndex(index: ArchiveIndex): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(index))
}

export function emptyIndex(name: string): ArchiveIndex {
  return { version: 1, name, entries: [] }
}

export function addEntry(index: ArchiveIndex, entry: ArchiveEntry): ArchiveIndex {
  return { ...index, entries: [entry, ...index.entries] }
}
