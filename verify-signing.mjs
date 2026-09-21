// Proves the signing-path fixes:
//
//   1. The base58 encoder in app.js is correct (checked against web3.js's own PublicKey codec,
//      using the real function extracted from app.js rather than a copy).
//   2. Nightly publishes its signing features on the WALLET, not the ACCOUNT.
//   3. Phantom returns the signature as raw bytes, which must be encoded before any RPC call.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright'
import { PublicKey, Keypair } from '@solana/web3.js'

const results = []
const check = (name, ok, extra = '') => {
  results.push([name, ok])
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''))
}

// ---------------------------------------------------------------------------
// 1. base58 encoder, extracted from app.js
// ---------------------------------------------------------------------------
const src = await readFile('app.js', 'utf8')
const from = src.indexOf('const BASE58_ALPHABET')
const to = src.indexOf('async function stamp()')
if (from < 0 || to < 0) throw new Error('could not locate the base58 helpers in app.js')
const { bytesToBase58, normalizeSignature } = new Function(
  src.slice(from, to) + '\nreturn { bytesToBase58, normalizeSignature }',
)()

console.log('=== base58 encoder (real code from app.js) ===')

// Round-trip against web3.js: whatever we encode, PublicKey must decode back to the same bytes.
let roundTripOk = true
for (let i = 0; i < 200; i++) {
  const bytes = new Uint8Array(randomBytes(32))
  if (bytes[0] === 0) bytes[0] = 1 // keep it a valid on-curve-length key for the codec
  const encoded = bytesToBase58(bytes)
  const back = new PublicKey(encoded).toBytes()
  if (Buffer.compare(Buffer.from(back), Buffer.from(bytes)) !== 0) {
    roundTripOk = false
    console.log('  mismatch at iteration', i)
    break
  }
}
check('200 random 32-byte values round-trip through PublicKey', roundTripOk)

// Known vectors, including the leading-zero case that a naive big-number encoder gets wrong.
check('leading zeros are preserved', bytesToBase58(new Uint8Array([0, 0, 1])) === '112', bytesToBase58(new Uint8Array([0, 0, 1])))
check('empty input encodes to empty string', bytesToBase58(new Uint8Array([])) === '')
check('single zero encodes to "1"', bytesToBase58(new Uint8Array([0])) === '1')

// A 64-byte signature must encode to the length Solana signatures actually have.
const sig64 = new Uint8Array(randomBytes(64))
const sig58 = bytesToBase58(sig64)
check('64-byte signature encodes to 87-88 chars', sig58.length === 87 || sig58.length === 88, 'got ' + sig58.length)

// normalizeSignature must accept every shape a wallet might return.
check('string passes through', normalizeSignature('abc') === 'abc')
check('Uint8Array is encoded', normalizeSignature(new Uint8Array([0, 0, 1])) === '112')
check('plain Array is encoded', normalizeSignature([0, 0, 1]) === '112')
check('null stays null', normalizeSignature(null) === null)

// ---------------------------------------------------------------------------
// 2 + 3. browser: wallet-level features and byte-array signatures
// ---------------------------------------------------------------------------
const PORT = 8098
const TARGET = process.argv[2] || 'http://localhost:' + PORT + '/'
const server = TARGET.includes('localhost')
  ? spawn(process.execPath, ['dev-server.mjs', String(PORT)], { stdio: 'ignore' })
  : null
if (server) await new Promise((r) => setTimeout(r, 1200))

const browser = await chromium.launch()
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(TARGET, { waitUntil: 'load' })
await page.waitForFunction(
  () => document.getElementById('wallet-state').textContent !== 'Detecting wallets…',
  null,
  { timeout: 20000 },
)

// Stand-in wallet copying the shape that broke things: signing features only on the wallet,
// an account with no `features`, and a signature returned as raw bytes the way Phantom does.
//
// The address is freshly generated, so it is guaranteed to hold no COOK — which is what the
// zero-balance guard has to react to.
const emptyAddress = Keypair.generate().publicKey.toBase58()
console.log('\nusing an address with no balance:', emptyAddress)

await page.evaluate((address) => {
  window.__stampCalls = []
  const account = {
    address,
    publicKey: new Uint8Array(32),
    chains: ['solana:mainnet'],
    features: {},
  }
  window.nightly = {
    solana: {
      version: '1.0.0',
      name: 'Nightly',
      icon: 'data:image/svg+xml;base64,PHN2Zy8+',
      chains: ['solana:mainnet'],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
        'solana:signAndSendTransaction': {
          version: '1.0.0',
          signAndSendTransaction: async (input) => {
            window.__stampCalls.push({ hasAccount: Boolean(input.account) })
            // Raw bytes, exactly what Phantom hands back.
            return [{ signature: new Uint8Array(64).fill(7) }]
          },
        },
      },
    },
  }
}, emptyAddress)

await page.waitForFunction(
  () => document.getElementById('wallet-state').textContent === 'Nightly detected',
  null,
  { timeout: 20000 },
)
await page.click('#btn-connect')
await page.waitForFunction(
  () => /^Connected/.test(document.getElementById('wallet-state').textContent),
  null,
  { timeout: 20000 },
)

// The balance line only appears once refreshBalance has actually decided something.
await page.waitForFunction(
  () => document.getElementById('wallet-state').textContent.includes('·'),
  null,
  { timeout: 30000 },
).catch(() => {})

const zeroBalance = await page.evaluate(() => ({
  state: document.getElementById('wallet-state').textContent,
  stampDisabled: document.getElementById('btn-stamp').disabled,
  error: document.getElementById('stamp-error').hidden ? '' : document.getElementById('stamp-error').textContent,
}))

console.log('\n=== zero-balance guard ===')
console.log('wallet state   :', zeroBalance.state)
console.log('stamp disabled :', zeroBalance.stampDisabled)
console.log('message        :', zeroBalance.error.slice(0, 120))

check('zero balance keeps the stamp button disabled', zeroBalance.stampDisabled === true)
check('the reason is explained to the user', /0 COOK|cannot pay/i.test(zeroBalance.error))

// The guard is what we just tested; now force it open to exercise the signing path itself.
await page.evaluate(() => { document.getElementById('btn-stamp').disabled = false })
await page.click('#btn-stamp')

// Wait for the signing call rather than guessing a duration — production loads web3.js from a
// CDN that may be cold, and building the transaction includes a round trip for the blockhash.
await page.waitForFunction(() => window.__stampCalls.length > 0, null, { timeout: 45000 }).catch(() => {})

// The base58 bug surfaced immediately after signing, so give it a moment to appear.
await page.waitForTimeout(4000)
const calls = await page.evaluate(() => window.__stampCalls)
const stampError = await page.$eval('#stamp-error', (n) => (n.hidden ? '' : n.textContent.trim()))

console.log('\n=== browser signing path ===')
console.log('calls into the wallet :', JSON.stringify(calls))
console.log('stamp error message   :', stampError || '(none — still waiting for confirmation)')

check('signAndSendTransaction is reached', calls.length === 1)
check('called with account passed in', calls[0]?.hasAccount === true)
check('byte-array signature no longer breaks encoding', !/base58 encoded/i.test(stampError))
check('no "exposes neither" error', !/exposes neither/.test(stampError))
check('no page errors', pageErrors.length === 0)

await browser.close()
server?.kill()

const failed = results.filter(([, ok]) => !ok).length
console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'))
process.exit(failed === 0 ? 0 : 1)
