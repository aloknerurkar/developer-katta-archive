import { Bytes, ChunkSplitter, Stamper, type Bee, type ChunkBuilder } from '@ethersphere/bee-js'
import type { KeyStore } from './feed'

export function stateKey(batchId: string): string {
  return `katta.stamper.${batchId}`
}

const BUCKETS = 65536 // 2^16 bucket counters, whatever the batch depth

export function encodeState(state: Uint32Array): string {
  return new Bytes(new Uint8Array(state.buffer, state.byteOffset, state.byteLength)).toHex()
}

export function decodeState(text: string): Uint32Array {
  const bytes = text ? new Bytes(text).toUint8Array() : new Uint8Array(0)
  // A short table is accepted by Stamper.fromState and then reuses slot indexes: refuse it.
  if (bytes.length !== BUCKETS * 4) {
    throw new Error(`Stamper state must hold ${BUCKETS} bucket counters (${BUCKETS * 4} bytes), got ${bytes.length} bytes`)
  }
  return new Uint32Array(bytes.slice().buffer)
}

// One uploader per batch: bucket counters live here, and a second stamper would reuse slots.
export function loadStamper(store: KeyStore, keyHex: string, batchId: string, depth: number): Stamper {
  const saved = store.getItem(stateKey(batchId))
  return saved ? Stamper.fromState(keyHex, batchId, decodeState(saved), depth) : Stamper.fromBlank(keyHex, batchId, depth)
}

export function saveStamper(store: KeyStore, batchId: string, stamper: Stamper): void {
  store.setItem(stateKey(batchId), encodeState(stamper.getState()))
}

// Build the chunk tree in the browser, stamp each chunk with our own batch key, and push it to any node.
export async function uploadSelfStamped(bee: Bee, stamper: Stamper, data: Uint8Array, persist: () => void): Promise<string> {
  throw new Error('TODO(l4): see GUIDE.md, section l4')
}
