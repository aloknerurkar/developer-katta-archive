# Build an archive no single party can remove

You will build a community archive on Swarm. By the end it has no host to switch off: the content is spread across the network, any node can serve it, the app checks every byte it receives, and only the keeper can update it.

Stuck? Commit your work, then `git checkout cp1` (or `cp2`, `cp3`) jumps to a finished checkpoint. The `solution` branch has everything.

## Checkpoint 0 (before 10:00)

First make the clone your own GitHub repo: the Katta rule is that you build in your own repo, not in ours. Create an empty repo on GitHub (no README, no license), then, inside the clone:

    git remote rename origin upstream
    git remote add origin <your repo URL>
    git push -u origin main

Or with the GitHub CLI, after the rename: `gh repo create <name> --public --source . --remote origin --push`. `git checkout cp1` (and `cp2`, `cp3`, `solution`) still works: the tags came with the clone, and `solution` is found on `upstream`. `git fetch upstream --tags` brings back a tag that is missing.

Then:

    npm install
    cp .env.example .env      # fill in from the cheat sheet
    npm run dev               # open http://localhost:5173

You should see "connected to https://w…". If not, check `VITE_WRITE_URL` and the wifi.

Every function you fill in starts as one line, `throw new Error('TODO(<level>): see GUIDE.md, section <level>')`. In each section below, open the file, find the function, and replace that `throw` line with the code shown. The TODO text in the app log or in a failing test names the level that is still missing.

## cp1: Publish (src/swarm/publish.ts → publishBytes)

Open `src/swarm/publish.ts`, find `publishBytes`, and replace its `throw new Error('TODO(cp1)…')` line with:

```ts
const { reference } = await bee.data.upload(batchId, data, { deferred: false })
return reference.toHex()
```

- Why `/bytes`: the reference is the hash of the content itself (the BMT root), so anyone can check it later.
- Why `deferred: false`: the call returns once the network has the chunks, so another node can read them straight away.

Check: add an entry in the app. The log shows `✓ entry published: <reference>`, then `✓ index published: <reference>`, then stops with `publish stopped: TODO(cp3)…`. That last line is expected: the feed arrives in cp3. Open `<VITE_WRITE_URL>/bytes/<reference>` in a new tab. `npm test -- -t "uploads bytes and returns their content reference"` passes. (The other publish tests read back through the cp2 reader, so they stay red until cp2.)

## cp2: Read through any path, trust none (src/swarm/reader.ts)

Open `src/swarm/reader.ts`. Two functions are stubbed; in each, replace the `throw new Error('TODO(cp2)…')` line.

1. `verifyBytes`: `ChunkSplitter.root(data)` rebuilds the chunk tree from the bytes, and its hash is the reference those bytes should have. Compare it with the reference you asked for.

   ```ts
   const root = await ChunkSplitter.root(data)
   return root.hash().equals(new Reference(reference))
   ```

2. `fetchVerified`: try each URL in order, take the first download that verifies, and record every failure as `{ url, reason }`. If nothing verifies, throw `AllPathsFailedError`.

   ```ts
   const failures: PathFailure[] = []
   for (const url of urls) {
     try {
       const signal = AbortSignal.timeout(timeoutMs)
       const data = (await makeBee(url).data.download(reference, undefined, { signal })).toUint8Array()
       if (await verifyBytes(data, reference)) return { data, url, failures }
       failures.push({ url, reason: 'hash mismatch: this path altered the content' })
     } catch (err) {
       failures.push({ url, reason: err instanceof Error ? err.message : String(err) })
     }
   }
   throw new AllPathsFailedError(failures)
   ```

Keep the `hash mismatch` prefix: the teardown check looks for it. The `signal` is there because bee-js doesn't enforce its own `timeout` option, so a hung gateway would otherwise stall the loop. `makeBee` (src/swarm/clients.ts) adds a 15 s deadline per call; the signal here is the tighter per-path `timeoutMs`.

Check: `npm test -- reader` passes, including the lying-gateway test and the hung-gateway test. The app can't show an entry yet: it lists an entry only once the feed points to it, and the feed is cp3. So cp2 is checked by the tests; the "Load (verified)" check in the app is under cp3.

## cp3: Update without a server (src/swarm/feed.ts)

A feed is a pointer signed by your keeper key: (owner, topic) → latest reference.

Open `src/swarm/feed.ts`. Two functions are stubbed; in each, replace the `throw new Error('TODO(cp3)…')` line.

1. `publishToFeed`: write the reference through a feed writer signed with the keeper key.

   ```ts
   await bee.feed.makeWriter(topic, key).uploadReference(batchId, reference, { deferred: false })
   ```

2. `readFeed`: ask a feed reader for the latest reference.

   ```ts
   const { reference } = await bee.feed.makeReader(topic, owner).downloadReference()
   return reference.toHex()
   ```

Check:

- Add two entries (an entry from cp1 is not in the feed, so add them again), then reload the page. The archive loads from the feed and shows both entries.
- Click "Load (verified)" on an entry: it shows `served by … · hash verified ✓`.
- Put `https://dead.invalid` first in `VITE_READ_URLS` (it fails at once), restart `npm run dev`, reload. The log shows the failure, then the next path serving. Then put `VITE_READ_URLS` back in its original order: L4 uploads go to the first entry, so it must be a live node.

Your keeper key is in this browser's localStorage. Lose it and you can't update your archive; leak it and someone else can. "Copy keeper key" puts it in your clipboard for `.env`.

## L1: Publish

Done when cp1–cp3 work: entries publish, load verified from any path, and the feed moves when you add one. Fill your archive with real entries: `npm run seed -- <folder>` reads `<folder>/entries.json`, a list of `{ "file", "title", "language", "region", "contributor", "contentType" }` where `file` is a path inside the folder. It needs `KEEPER_KEY` in `.env` ("Copy keeper key" in the app). Seeding builds a new index from the folder and moves the feed to it, so seed first and add entries by hand after.

## L2: Unhostable

    npm run deploy

With `KEEPER_KEY` in `.env`, this builds the app, uploads it as a website, points your site feed at it, and prints a stable URL per read path. Open two of them: the same app, served by two different nodes. If one node goes away, the other still serves it.

The deployed app is read-only for visitors: `deploy` bakes your keeper address in as `VITE_ARCHIVE_OWNER`, so it shows your archive and nobody else gets the publish form. Keeper actions and the L4 panel only run in the local `npm run dev` app.

## L3: Keep it alive (src/swarm/keepalive.ts)

Open `src/swarm/keepalive.ts`. Four functions are stubbed; in each, replace the `throw new Error('TODO(l3)…')` line.

1. `batchStatus`: `GET /stamps/{id}` on the node that owns the batch. `usable` is `batch.usable`, `ttlDays` is whole days left and `usagePercent` is how full the batch is (`usage` runs 0–1).

   ```ts
   const batch = await bee.stamp.get(batchId)
   return { usable: batch.usable, ttlDays: Math.floor(batch.duration.toDays()), usagePercent: Math.round(batch.usage * 100) }
   ```

2. `isRetrievable`: can the network still serve every chunk of this reference?

   ```ts
   return bee.data.isRetrievable(reference)
   ```

3. `pinOn`: ask node B to fetch the content and keep its own copy.

   ```ts
   await bee.pin.add(reference)
   ```

4. `adopt`: node B re-uploads someone else's content under its own batch, and the address stays the same.

   ```ts
   await bee.pin.reuploadData(adoptBatchId, reference)
   ```

`npm run deploy -- --redundancy` adds erasure coding to the app upload. Entries stay plain, so the reader can still check their hash: an erasure-coded tree hashes differently from the plain bytes.

Check: "Check our postage batch" and "Still retrievable?" in the app answer, and the Pin and Re-upload buttons (they show once `VITE_ADOPT_URL` is set; Re-upload also needs `VITE_ADOPT_BATCH_ID`) work on another team's archive. Ask them for their index reference and paste it in: an index pins or re-uploads every entry it lists too.

## L4: Write without our node (src/swarm/stamper.ts → uploadSelfStamped)

Your team card has a batch ID, a depth and a stamping key. One person per team uploads, from one browser: the bucket counters live in that browser's localStorage, and a second uploader would reuse stamp slots and overwrite chunks.

Open `src/swarm/stamper.ts`, find `uploadSelfStamped`, and replace its `throw new Error('TODO(l4)…')` line with the three parts below, in order.

1. `put(chunk)` stamps one chunk and pushes it. It first checks a per-upload `sent` Set of chunk addresses and returns early for a chunk already uploaded, then stamp → persist → upload, then adds the address to `sent`. Why the Set: identical chunks (silence, zero padding) would otherwise burn a stamp slot each and fill a bucket. Why `persist()` before the upload: the saved counters never lag behind a stamp that has already left.

   ```ts
   const sent = new Set<string>() // same content, same address: Bee reuses its slot, Stamper would burn a new one
   const put = async (chunk: ChunkBuilder) => {
     const address = chunk.hash().toHex()
     if (sent.has(address)) return
     const envelope = stamper.stamp(chunk.hash().toUint8Array())
     persist()
     await bee.chunk.upload(envelope, chunk.build(), { deferred: false })
     sent.add(address)
   }
   ```

2. Build the chunk tree in the browser and hand every chunk the splitter produces to `put`:

   ```ts
   const splitter = new ChunkSplitter(async entries => {
     for (const { chunk } of entries) await put(chunk)
     return []
   })
   ```

3. Feed it the data, then stamp and send the root, and return the root's address:

   ```ts
   await splitter.append(data)
   const root = await splitter.finalize()
   await put(root)
   return root.hash().toHex()
   ```

Then use it: the app has an "L4: publish with our team stamps" panel. Enter the team card's batch ID, depth and stamping key, and tick "use team stamps". Entries and the index now upload pre-stamped to the first read node in `VITE_READ_URLS`, not to W. Any node accepts pre-stamped chunks: our write node is no longer needed for content. The feed update still goes through W with the shared batch.

Before you try it, check that the first entry in `VITE_READ_URLS` is a live node. If you left `https://dead.invalid` (or any dead URL) there after the cp3 exercise, put the original order back. `put` stamps the chunk and saves the counters before it uploads, so a dead first node uses up a stamp slot and then fails: the log shows `uploading via <the dead URL>`, then `publish stopped: …`.

Check: add an entry. The log shows `stamping with team batch …, uploading via <read node>`. `npm test -- stamper` passes.

Keep the team key out of `VITE_*` variables: those are baked into the bundle, and `npm run deploy` would publish your key on Swarm. Paste it into the panel at runtime: it stays in localStorage, like the keeper key.

## 16:00 teardown

    npm run teardown -- --site <site manifest> --owner <keeper address> --liar <liar URL from the cheat sheet>

`npm run deploy` prints the site manifest and your keeper address, and a teardown command that has no `--liar`. Add `--liar <liar URL from the cheat sheet>` yourself: without it, check 3 prints SKIP. SKIP means a flag is missing and the check did not run, so it is not a pass.

| Check | Passes when |
|---|---|
| 1 | your app loads from 2+ distinct read URLs in `VITE_READ_URLS` (counted by origin: one node listed twice counts once) |
| 2 | your index feed has 2+ updates and at least one entry |
| 3 | your reader rejects the lying gateway's bytes (the liar must be reachable and actually tamper) |
| 4 | the app built from your code (js, mjs, css and html) references no host except your Swarm nodes; a failed build counts as a FAIL |

## Honest limits

- Content lives while a postage batch pays for it. Anyone can extend a batch, or re-upload content with their own.
- Feed lookups are answered by a node. The reader verifies content, but a lying node could point you at an older index.
- A gateway sees who you are. Run your own node to avoid that.
- ENS (on mainnet) trusts the Ethereum RPC that resolves it.
