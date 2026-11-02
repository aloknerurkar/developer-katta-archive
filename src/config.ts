export type Env = Record<string, string | boolean | undefined>

export interface AppConfig {
  writeUrl: string
  readUrls: string[]
  batchId: string
  archiveOwner: string | null
  adoptUrl: string | null
  adoptBatchId: string | null
}

const HEX64 = /^[0-9a-fA-F]{64}$/

function value(env: Env, key: string): string | null {
  const v = env[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function loadConfig(env: Env): AppConfig {
  const writeUrl = value(env, 'VITE_WRITE_URL')
  const reads = value(env, 'VITE_READ_URLS')
  const batchId = value(env, 'VITE_BATCH_ID')
  if (!writeUrl || !reads || !batchId) {
    throw new Error('Missing VITE_WRITE_URL, VITE_READ_URLS or VITE_BATCH_ID: copy .env.example to .env and fill it in from the cheat sheet')
  }
  if (!HEX64.test(batchId)) throw new Error('VITE_BATCH_ID must be 64 hex characters')
  const adoptUrl = value(env, 'VITE_ADOPT_URL')
  return {
    writeUrl: trimSlash(writeUrl),
    readUrls: reads.split(',').map(s => trimSlash(s.trim())).filter(Boolean),
    batchId,
    archiveOwner: value(env, 'VITE_ARCHIVE_OWNER'),
    adoptUrl: adoptUrl ? trimSlash(adoptUrl) : null,
    adoptBatchId: value(env, 'VITE_ADOPT_BATCH_ID'),
  }
}

// When the app itself is served from a node's /bzz/ route, that node is a read path too.
export function servingNode(location: { origin: string; pathname: string }): string | null {
  return location.pathname.startsWith('/bzz/') ? location.origin : null
}

export function readPaths(config: AppConfig, location?: { origin: string; pathname: string }): string[] {
  const own = location ? servingNode(location) : null
  return own && !config.readUrls.includes(own) ? [own, ...config.readUrls] : config.readUrls
}
