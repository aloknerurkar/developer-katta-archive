# Community archive on Swarm (Devcon 8 · Developers Katta · Day 1)

A starter for building an archive that no single party can remove. Start with GUIDE.md.

    git clone https://github.com/aloknerurkar/developer-katta-archive
    cd developer-katta-archive

Then make the clone your own GitHub repo (the Katta rule: you build in your own repo). Create an empty repo on GitHub, then:

    git remote rename origin upstream
    git remote add origin <your repo URL>    # or: gh repo create <name> --public --source . --remote origin --push
    git push -u origin main                  # not needed after gh repo create

`git checkout cp1` still works: the tags came with the clone (`git fetch upstream --tags` if one is missing). Then:

    npm install
    cp .env.example .env    # values from the cheat sheet
    npm run dev

Needs Node 22.12+ (22.x) or 24+, and a current browser: Chrome 116+, Firefox 124+ or Safari 17.4+ (the reader and client use `AbortSignal.any`).

| Command | What it does |
|---|---|
| `npm run dev` | run the app locally |
| `npm test` | unit tests: they start red and turn green as you finish the checkpoints. All of them pass except the L4 stamper tests until L4 is done |
| `npm run deploy` | publish the app itself to Swarm behind a stable feed URL |
| `npm run seed -- <folder>` | bulk-publish entries from `<folder>/entries.json` |
| `npm run teardown -- --site … --owner … --liar …` | the 16:00 checks |

Notes:

- The deployed app (`npm run deploy`) is read-only for visitors. Keeper actions and the L4 team-stamps panel only run in the local `npm run dev` app.
- L4 uploads go to the first `VITE_READ_URLS` entry. If you put `https://dead.invalid` first for the dead-URL exercise in cp3, restore the original order before L4.

Built with `@ethersphere/bee-js` 13.2.0 against Bee 2.8.3 on the Sepolia testnet.
License: BSD-3-Clause.
