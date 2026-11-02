import { ChunkSplitter, Reference } from '@ethersphere/bee-js'
import { makeBee } from './clients'

export interface PathFailure {
  url: string
  reason: string
}

export interface FetchResult {
  data: Uint8Array
  url: string
  failures: PathFailure[]
}

export class AllPathsFailedError extends Error {
  constructor(readonly failures: PathFailure[]) {
    super(`no path served verified content: ${failures.map(f => `${f.url} (${f.reason})`).join('; ')}`)
  }
}

// A /bytes reference is the BMT root of the content, so anyone can recompute it.
export async function verifyBytes(data: Uint8Array, reference: string): Promise<boolean> {
  throw new Error('TODO(cp2): see GUIDE.md, section cp2')
}

// Trust no gateway: try each path in order and accept only bytes that hash to the reference.
export async function fetchVerified(urls: string[], reference: string, timeoutMs = 8_000): Promise<FetchResult> {
  throw new Error('TODO(cp2): see GUIDE.md, section cp2')
}
