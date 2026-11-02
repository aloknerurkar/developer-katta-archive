import { PrivateKey, RedundancyLevel } from '@ethersphere/bee-js'
import { build } from 'vite'
import { loadConfig } from '../src/config'
import { makeBee } from '../src/swarm/clients'
import { SITE_TOPIC, keeperAddress, publishToFeed } from '../src/swarm/feed'

const keyHex = process.env.KEEPER_KEY
if (!keyHex) {
  console.error('Set KEEPER_KEY in .env: in the app, use "Copy keeper key".')
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
const owner = keeperAddress(key)
process.env.VITE_ARCHIVE_OWNER = owner // baked into the build so any visitor sees this archive
const config = loadConfig(process.env)
const redundancyLevel = process.argv.includes('--redundancy') ? RedundancyLevel.MEDIUM : RedundancyLevel.OFF

await build({ base: './', logLevel: 'warn' })
const bee = makeBee(config.writeUrl, 300_000)
const { reference } = await bee.collection.uploadFromDirectory(config.batchId, 'dist', { indexDocument: 'index.html', redundancyLevel, deferred: false })
await publishToFeed(bee, config.batchId, key, SITE_TOPIC, reference.toHex())
const manifest = (await bee.feed.createManifest(config.batchId, SITE_TOPIC, owner, { deferred: false })).toHex()

console.log(`keeper:        ${owner}`)
console.log(`site upload:   ${reference.toHex()}`)
console.log(`site manifest: ${manifest}  (stable: redeploys move the feed, not this)`)
for (const url of config.readUrls) console.log(`  ${url}/bzz/${manifest}/`)
console.log(`teardown:      npm run teardown -- --site ${manifest} --owner ${owner}`)
