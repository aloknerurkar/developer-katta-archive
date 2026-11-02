import type { Bee } from '@ethersphere/bee-js'
import { parseIndex, serializeIndex, type ArchiveEntry, type ArchiveIndex } from './types'

export type EntryMeta = Omit<ArchiveEntry, 'reference'>

// POST /bytes: the reference is the BMT root of the content, so readers can verify it.
export async function publishBytes(bee: Bee, batchId: string, data: Uint8Array): Promise<string> {
  throw new Error('TODO(cp1): see GUIDE.md, section cp1')
}

export async function publishEntry(bee: Bee, batchId: string, data: Uint8Array, meta: EntryMeta): Promise<ArchiveEntry> {
  return { ...meta, reference: await publishBytes(bee, batchId, data) }
}

export async function publishIndex(bee: Bee, batchId: string, index: ArchiveIndex): Promise<string> {
  const bytes = serializeIndex(index)
  parseIndex(bytes) // throws InvalidIndexError: never publish an index every reader would reject
  return publishBytes(bee, batchId, bytes)
}
