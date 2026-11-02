import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateKey } from '@ethersphere/bee-js'
import { loadConfig } from '../src/config'
import { makeBee } from '../src/swarm/clients'
import { INDEX_TOPIC, keeperAddress, publishToFeed } from '../src/swarm/feed'
import { publishEntry, publishIndex } from '../src/swarm/publish'
import { InvalidIndexError, addEntry, emptyIndex } from '../src/swarm/types'

interface SeedItem { file: string; title: string; language: string; region: string; contributor: string; contentType: string }

const folder = process.argv[2]
const name = process.argv[3] ?? 'Our community archive'
const keyHex = process.env.KEEPER_KEY
if (!folder || !keyHex) {
  console.error('usage: npm run seed -- <folder with entries.json> ["archive name"]   (KEEPER_KEY must be set in .env)')
  process.exit(1)
}
// The parse error echoes the whole value: say nothing about it.
let key: PrivateKey
try {
  key = new PrivateKey(keyHex)
} catch {
  console.error('KEEPER_KEY in .env is not a valid key (64 hex characters): copy it again with "Copy keeper key" in the app.')
  process.exit(1)
}
const config = loadConfig(process.env)
const bee = makeBee(config.writeUrl, 300_000)
const items = JSON.parse(readFileSync(join(folder, 'entries.json'), 'utf8')) as SeedItem[]

let index = emptyIndex(name)
for (const item of items) {
  const data = new Uint8Array(readFileSync(join(folder, item.file)))
  const { file, ...meta } = item
  const entry = await publishEntry(bee, config.batchId, data, { ...meta, date: new Date().toISOString().slice(0, 10) })
  index = addEntry(index, entry)
  console.log(`entry ${entry.reference}  ${file}`)
}
let indexRef: string
try {
  indexRef = await publishIndex(bee, config.batchId, index)
} catch (err) {
  if (!(err instanceof InvalidIndexError)) throw err
  console.error(`the index is not valid, so it was not published and the feed is unchanged: ${err.message}`)
  console.error('check entries.json: every title, language, region, contributor and contentType must be text of at most 200 characters, and there can be at most 1000 entries.')
  process.exit(1)
}
await publishToFeed(bee, config.batchId, key, INDEX_TOPIC, indexRef)
console.log(`index ${indexRef} published to the index feed of ${keeperAddress(key)}`)
