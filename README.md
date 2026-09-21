# Cookie Board

A Cookie Chain dashboard that reads the chain's public index and lets a wallet write to the
chain — built for the **Create an App on Cookie Chain** bounty.

Live app: <https://cookie-board-4fv.pages.dev/>
Repository: <https://github.com/kaminariouji/cookie-board>

---

## What it does

Cookie Board has two halves, and they are deliberately separated:

**Read half — works with zero COOK.** Everything below runs off public HTTP endpoints, so the
page is fully useful to someone who has never bridged a token in:

| Panel | Source | What it shows |
|---|---|---|
| Network | `rpc.cookiescan.io` + `api.cookiescan.io` | Health, slot, epoch, block height, lifetime transaction count, real TPS (excluding votes), COOK price, token and market counts |
| Liquidity markets | `GET /api/markets` | 169 pools across CookieSwap and CookieBox, ranked by USD liquidity, with an SVG bar chart and a venue filter |
| Token analytics | `GET /api/tokens`, `GET /api/tokens/search` | 6,545 indexed tokens with price, market cap, liquidity and holder count |

**Write half — needs a small amount of COOK.** A single **Memo** instruction is written into a
real Cookie Chain transaction. It is the cheapest honest way to prove a wallet executed
something on this chain, and it exercises the full path a production app needs: build, sign,
broadcast, confirm, report.

---

## Why it is built this way

**The read half needs no tokens on purpose.** Cookie Chain has no faucet and no testnet — the
only ways to obtain COOK are the bridge, a DEX swap, or a transfer from another holder. A
dashboard that demanded COOK before showing anything would be useless to a first-time visitor.
So the analytics load for everyone, and the stamp is opt-in.

**The wallet integration follows the standard, not a guess.** Nightly documents
`window.nightly.solana`, but it is also a Solana Wallet Standard wallet. Cookie Board checks the
documented path first and then falls back to the Wallet Standard registry, so any compliant
wallet works and Nightly is always preferred.

**Dependencies load from two CDNs.** Solana libraries are large; if one host is slow the page
would render blank. `loadModule()` walks a list of sources and only gives up when all fail.

**No build step.** The files served are the files in this repository. There is no bundler to
diverge from the source, and nothing to rebuild before deploying.

---

## Setup

### Requirements

- A modern browser
- [Nightly](https://nightly.app) (or any Solana Wallet Standard wallet) — **only needed for the on-chain stamp**
- Node.js 18+ — **only needed to run the local dev server**

### Run locally

```bash
node dev-server.mjs 8080
# open http://localhost:8080
```

`dev-server.mjs` is a ~40-line static file server. There is no dependency install for the app
itself; `npm install` is only required if you want to run the Playwright verification.

### Deploy

The app is three static files, so any static host works. Use `deploy.mjs`, not a bare
`wrangler pages deploy .` — the bare command uploads the whole directory, and `.assetsignore`
is not honoured on the Pages path, which leaks `verify.mjs`, `package.json` and this README to
the public URL. `deploy.mjs` stages only the three browser files and verifies the staging
directory before uploading.

```bash
set -a && . ../.env && set +a   # provides CLOUDFLARE_API_TOKEN
node deploy.mjs cookie-board
```

First time only, create the project:

```bash
npx wrangler pages project create cookie-board --production-branch main
```

**Anywhere else** — copy `index.html`, `app.js` and `styles.css` to the host. No server-side
code, no environment variables.

### Connect Nightly to Cookie Chain

Nightly needs to be pointed at this chain before it can sign anything here.

1. Install Nightly from [nightly.app](https://nightly.app)
2. Open the wallet's network settings and add a custom SVM network
3. RPC: `https://rpc.cookiescan.io`
4. WebSocket: `https://wss.cookiescan.io`

### Getting COOK for the stamp

There is no faucet. Bridge COOK from Solana at <https://hyperlane.cookiescan.io>. One
transaction costs a single signature fee, paid in COOK — at the time of writing COOK trades
around $0.00008, so the fee is a fraction of a cent. Any non-zero balance is enough.

---

## Verification

`verify.mjs` drives the deployed page in a real Chromium instance and asserts the panels
actually populate — it fails loudly rather than reporting "no syntax errors".

```bash
npm install
npx playwright install chromium
node dev-server.mjs 8080 &
node verify.mjs http://localhost:8080/
```

It checks that the network cards fill in, that the market table and chart render, that venue
filtering changes the row count, that token search returns results, and it reports every
console error, page error and failed request. A screenshot is written to `verify-shot.png`.

---

## API reference used

All endpoints are public, unauthenticated, and CORS-enabled.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/status` | Chain summary: COOK price and mint, active/total tokens, metadata cache size |
| `GET` | `/api/tokens` | Full token directory (~3.9 MB, 6,545 entries) |
| `GET` | `/api/tokens/search?q=` | Indexed token search |
| `GET` | `/api/markets` | All liquidity pools with reserves and USD liquidity |
| `GET` | `/api/markets/:mint` | Pools for one mint |
| `GET` | `/api/price/:mint` | Price for one mint |
| `GET` | `/api/price/cook` | COOK price detail |
| `GET` | `/api/cook` | COOK token record |

JSON-RPC methods used: `getHealth`, `getEpochInfo`, `getRecentPerformanceSamples`,
`getLatestBlockhash`, `getBalance`, `sendRawTransaction`, `confirmTransaction`.

The `/api/tokens` response is several megabytes, so it is fetched only when the user presses
**Load full directory**. Search hits the index instead and stays instant.

---

## On-chain details

| Item | Value |
|---|---|
| Chain | Cookie Chain (independent SVM, `solana-core` 4.1.2) |
| Genesis hash | `9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2` |
| CAIP-2 chain id | `solana:9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZ` |
| Native token | COOK, 9 decimals |
| COOK mint | `36ZrtQoab5MhhySaP1YSTwUahSk6GRVUTtZ6cuVfm9e1` |
| Memo program | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Explorer | <https://cookiescan.io> |
| Bridge | <https://hyperlane.cookiescan.io> |

The Memo program id is taken from the genesis program list in the official Cookie Chain docs
(`docs.cookiechain.wtf/ecosystem`), and the CAIP-2 chain id is derived the way Solana CAIP-2
ids are defined: `solana:` plus the first 32 characters of the genesis hash.

### Programs this app touches

- **Memo** — the stamp writes here
- **CookieSwap** (`COOKIESWAP CPAMM`, `COOKIESWAP SAMM`) and **CookieBox** (`COOKIEBOX DAMM`,
  `COOKIEBOX CLMM`) — read through the index, used to rank liquidity
- **Meteora DAMM** — also present on the chain, read the same way

---

## Known limitations

These are real and worth stating rather than hiding.

- **The stamp cannot be tested with an empty wallet.** It needs a non-zero COOK balance to pay
  the fee. The UI detects a zero balance and explains how to fix it instead of failing at the
  signature prompt.
- **Wallet-reported chain ids vary.** A wallet that lists the account as `solana:mainnet` while
  pointed at Cookie Chain's RPC will still sign the bytes we hand it, because the transaction is
  serialized locally with a Cookie Chain blockhash. If a wallet rejects on chain mismatch, the
  stamp reports the wallet's own error message verbatim.
- **Token metadata can point at dead gateways.** Many of the 6,545 tokens use IPFS logos that no
  longer resolve; those rows fall back to a symbol monogram.
- **Prices come from the index, not from an oracle.** They are only as good as CookieScan's
  indexer.

---

## Project layout

```
cookie-board/
├── index.html        markup and section structure
├── styles.css        theme; no external fonts or images
├── app.js            all logic — data, charts, wallet, stamp
├── dev-server.mjs    static file server for local development
├── deploy.mjs        stages the three browser files and deploys them
├── verify.mjs        Playwright check that the panels actually populate
├── X-THREAD.md       the launch thread
└── package.json      dev dependency for verify.mjs only
```

## License

MIT — see `LICENSE`.
