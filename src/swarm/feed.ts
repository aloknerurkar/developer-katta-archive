import { PrivateKey, Topic, type Bee } from '@ethersphere/bee-js'
import { makeBee } from './clients'

export interface KeyStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const KEEPER_KEY_STORAGE = 'katta.keeper.key'
export const INDEX_TOPIC = Topic.fromString('katta-archive/index')
export const SITE_TOPIC = Topic.fromString('katta-archive/site')

// The keeper key is the archive's identity: whoever holds it can move the feed.
export function loadOrCreateKeeperKey(store: KeyStore): PrivateKey {
  const saved = store.getItem(KEEPER_KEY_STORAGE)
  if (saved) {
    // The parse error echoes the whole value and this message can reach the projector: say nothing about it.
    try {
      return new PrivateKey(saved)
    } catch {
      throw new Error('stored keeper key is malformed')
    }
  }
  const key = new PrivateKey(crypto.getRandomValues(new Uint8Array(32)))
  store.setItem(KEEPER_KEY_STORAGE, key.toHex())
  return key
}

export function keeperAddress(key: PrivateKey): string {
  return key.publicKey().address().toHex()
}

export async function publishToFeed(bee: Bee, batchId: string, key: PrivateKey, topic: Topic, reference: string): Promise<void> {
  throw new Error('TODO(cp3): see GUIDE.md, section cp3')
}

export async function readFeed(bee: Bee, owner: string, topic: Topic): Promise<string> {
  throw new Error('TODO(cp3): see GUIDE.md, section cp3')
}

// Feed lookups are answered by a node, so try every path like the reader does.
export async function readFeedAnyPath(urls: string[], owner: string, topic: Topic): Promise<string> {
  const reasons: string[] = []
  for (const url of urls) {
    try {
      return await readFeed(makeBee(url), owner, topic)
    } catch (err) {
      reasons.push(`${url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`feed not found on any path (${reasons.join('; ')})`)
}
