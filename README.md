# Cookie Board

A Cookie Chain dashboard that reads the chain's public index and lets a wallet write to the
chain — built for the **Create an App on Cookie Chain** bounty.

Live app: <https://cookie-board-4fv.pages.dev/>
Repository: <https://github.com/kaminariouji/cookie-board>
Launch thread: <https://x.com/kaminariouji/status/2102039454127116698>

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

Two things about Nightly were only learned by testing against the real extension. Both are now
handled explicitly, and both would have been missed by reading the spec alone:

- **It injects late.** Phantom, Solflare and MetaMask attach themselves before `app.js` runs;
  Nightly arrives afterwards. A single check at startup therefore finds every wallet *except*
  Nightly — which is exactly the wallet the bounty asks for. Detection now re-runs on a short
  schedule and also listens for the Wallet Standard `register` event, so a wallet that shows up
  late is picked up without a reload.
- **It publishes signing features on the wallet, not the account.** The standard puts
  `solana:signAndSendTransaction` and `solana:signTransaction` on the `WalletAccount`; Nightly
  puts them on `window.nightly.solana.features` and returns accounts with no `features` at all.
  Looking only at the account made the app conclude the wallet could not sign. `signingFeature()`
  now searches both, and passes `account` explicitly when the feature came from the wallet, which
  is what that variant requires.

A third difference showed up only when signing with a funded wallet. Wallets disagree about the
type of the value `signAndSendTransaction` returns:

| Wallet | Returns | Handled by |
|---|---|---|
| Nightly | base58 **string** | passed through |
| Phantom | raw **byte array** | `normalizeSignature()` encodes it |

`confirmTransaction` and the explorer link only accept base58 text, so a byte array used to fail
with *"signature must be base58 encoded"* — after the transaction had already been broadcast.
The encoding is done in `app.js` rather than pulling in a base58 dependency, and
`verify-signing.mjs` checks it against web3.js's own codec over 200 random values.

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

Wrangler reads `CLOUDFLARE_API_TOKEN` from a `.env` file **in the working directory**, not from
the directory the script lives in. Run `deploy.mjs` from wherever your `.env` is:

```bash
cd /path/to/dir/holding/.env
node /path/to/cookie-board/deploy.mjs cookie-board
```

Running it from inside `cookie-board/` fails with *"In a non-interactive environment, it's
necessary to set a CLOUDFLARE_API_TOKEN"* even when the token is valid and present. Staging is
unaffected either way, because the script resolves its own paths from `import.meta.url`.

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

There is no faucet. Bridge COOK from Solana at <https://hyperlane.cookiescan.io>.

The fee is one signature. Cookie Chain's own RPC reports it: **5,000 lamports = 0.000005 COOK**,
which at the current COOK price is about **$0.0000000004**. Any non-zero balance covers hundreds
of thousands of stamps.

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

`verify-stamp.mjs` covers the other half — the part that needs a wallet, and therefore the part
most likely to be wrong without anyone noticing. It rebuilds the exact Memo transaction `app.js`
builds, then asks Cookie Chain to simulate it:

```bash
node verify-stamp.mjs
```

```
Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]
Program log: Signed by DL9GPSXrhAEnU5Ads3HLhEJ9fCDLpnmmkzxoe712W4xP
Program log: Memo (len 20): "gm from Cookie Board"
Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr consumed 22204 of 200000 compute units
Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr success
```

`err: null` means the chain's runtime accepted the instruction, the Memo program is present and
executable, and the text lands in the transaction log. The same run asks the RPC for the real fee
rather than guessing: **5,000 lamports**.

The fee payer in that test is a real funded Cookie Chain account found by `find-payer.mjs`. It is
only a fee payer with signature verification off — nothing is signed and nothing is spent. Using
an invented address instead makes the simulation abort at `AccountNotFound` before the Memo
instruction ever runs, which would prove nothing.

`verify-wallet.mjs` reproduces the late-injection problem without needing the extension. It loads
the page, confirms the app reports no wallet, then injects `window.nightly` **afterwards** and
asserts the UI recovers on its own:

```bash
node verify-wallet.mjs https://cookie-board-4fv.pages.dev/
```

```
initial: state reports no wallet          PASS
initial: Connect button hidden            PASS
initial: install link shown               PASS
final: state becomes "Nightly detected"   PASS
final: Connect button visible again       PASS
final: no console errors                  PASS
ALL PASS
```

`verify-signing.mjs` covers the wallet-level signing features. It injects a stand-in that copies
Nightly's shape — signing features on the wallet, an account with **no** `features` — then clicks
Connect and Stamp and asserts the signing method is actually reached, with `account` attached:

```bash
node verify-signing.mjs https://cookie-board-4fv.pages.dev/
```

Both scripts accept a URL argument, so the same check runs against localhost and production.

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

- **The stamp is confirmed on chain, signed with Nightly.** A funded wallet signed a stamp and the
  app read the result back as confirmed. Read straight from Cookie Chain's RPC, not from the app:

  ```
  signature : 23prywrS5kpXokJYxMjw4B771EWT7hTtwEm1yABuwrXTE5jF6JQaTTbP4GdwB2rVTSreHDuofDC5Y8iecGUPfSK8
  slot      : 26446164
  err       : null
  fee       : 5000 lamports
  log       : Program log: Memo (len 20): "gm from Cookie Board"
  ```

  https://cookiescan.io/tx/23prywrS5kpXokJYxMjw4B771EWT7hTtwEm1yABuwrXTE5jF6JQaTTbP4GdwB2rVTSreHDuofDC5Y8iecGUPfSK8

  Nightly is the wallet the setup steps below recommend, and it is the one that failed first: it
  publishes its signing features on the wallet rather than the account, so the stamp reported
  "this wallet exposes neither signAndSendTransaction nor signTransaction". That bug is fixed, and
  this transaction is the proof. The run exercised every hop in one pass — build, wallet
  signature, broadcast, confirmation — and each of the three wallet bugs below was only visible
  against a real wallet, never in the individual hop tests.
- **The stamp needs a funded wallet, and Cookie Chain has no official faucet.** The dashboard
  above works without any COOK; only the stamp needs a balance, because it pays a network fee.
  Getting COOK means bridging from Solana or receiving it from an existing wallet.
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
├── verify-stamp.mjs  simulates the Memo transaction against Cookie Chain
├── verify-wallet.mjs reproduces late wallet injection and checks the UI recovers
├── verify-signing.mjs checks wallet-level signing features are reached
├── find-payer.mjs    finds a real funded account to use as a simulation fee payer
└── package.json      dev dependencies for the verification scripts
```

## License

MIT — see `LICENSE`.
