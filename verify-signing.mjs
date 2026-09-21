// Proves the signing-path fix: Nightly publishes its signing features on the WALLET
// (`window.nightly.solana.features`), while the old code only looked on the ACCOUNT.
//
// This test injects a stand-in that copies that shape — an account with NO `features` — then
// checks that the Stamp button really reaches signAndSendTransaction, and passes `account` in
// (which is what the wallet-level variant of the feature requires).
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 8098
const TARGET = process.argv[2] || 'http://localhost:' + PORT + '/'
const server = TARGET.includes('localhost')
  ? spawn(process.execPath, ['dev-server.mjs', String(PORT)], { stdio: 'ignore' })
  : null
if (server) await new Promise((r) => setTimeout(r, 1200))
console.log('testing:', TARGET)

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

// Stand-in wallet: signing features exist only on the wallet, never on the account.
await page.evaluate(() => {
  window.__stampCalls = []
  const account = {
    address: 'DL9GPSXrhAEnU5Ads3HLhEJ9fCDLpnmmkzxoe712W4xP',
    publicKey: new Uint8Array(32),
    chains: ['solana:mainnet'],
    features: {}, // <- empty, exactly as Nightly returns it
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
            window.__stampCalls.push({
              inputKeys: Object.keys(input).sort().join(','),
              hasAccount: Boolean(input.account),
              accountAddress: input.account?.address ?? null,
            })
            return [{ signature: '5'.repeat(64) }]
          },
        },
      },
    },
  }
})

// The wallet appears late -> the UI has to recover on its own.
await page.waitForFunction(
  () => document.getElementById('wallet-state').textContent === 'Nightly detected',
  null,
  { timeout: 20000 },
)
console.log('wallet detected       : yes')

await page.click('#btn-connect')
await page.waitForFunction(
  () => /^Connected/.test(document.getElementById('wallet-state').textContent),
  null,
  { timeout: 20000 },
)
console.log('connect               :', (await page.textContent('#wallet-state')).trim())

// This test account holds no COOK, so refreshBalance disables the button. Re-enable it to
// exercise the signing path itself.
await page.evaluate(() => { document.getElementById('btn-stamp').disabled = false })
await page.click('#btn-stamp')

await page.waitForFunction(() => window.__stampCalls.length > 0, null, { timeout: 30000 }).catch(() => {})
const calls = await page.evaluate(() => window.__stampCalls)
const stampError = await page.$eval('#stamp-error', (n) => (n.hidden ? '' : n.textContent.trim()))

console.log('\ncalls into the wallet :', JSON.stringify(calls))
console.log('stamp error message   :', stampError || '(none)')

console.log('\n' + '='.repeat(60))
const checks = [
  ['signAndSendTransaction is actually reached', calls.length === 1],
  ['called with account passed in', calls[0]?.hasAccount === true],
  ['account sent is the right address', calls[0]?.accountAddress === 'DL9GPSXrhAEnU5Ads3HLhEJ9fCDLpnmmkzxoe712W4xP'],
  ['no "exposes neither" error', !/exposes neither/.test(stampError)],
  ['no page errors', pageErrors.length === 0],
]
for (const [name, ok] of checks) console.log((ok ? 'PASS  ' : 'FAIL  ') + name)

const failed = checks.filter(([, ok]) => !ok).length
console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'))

await browser.close()
server?.kill()
process.exit(failed === 0 ? 0 : 1)
