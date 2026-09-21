// Proves the wallet-detection fix works for the case that actually broke it: the extension
// injects window.nightly AFTER app.js has finished running.
//
// What it checks:
//   1. No extension present -> UI offers the install link, Connect stays hidden
//   2. window.nightly appears later -> UI must recover on its own, without a reload
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 8099
const TARGET = process.argv[2] || 'http://localhost:' + PORT + '/'
const server = TARGET.includes('localhost')
  ? spawn(process.execPath, ['dev-server.mjs', String(PORT)], { stdio: 'ignore' })
  : null
if (server) await new Promise((r) => setTimeout(r, 1200))
console.log('testing:', TARGET)

const browser = await chromium.launch()
const page = await browser.newPage()

const consoleErrors = []
const pageErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => pageErrors.push(e.message))

const snap = async (label) => {
  const s = await page.evaluate(() => ({
    state: document.getElementById('wallet-state').textContent,
    connectHidden: document.getElementById('btn-connect').hidden,
    connectText: document.getElementById('btn-connect').textContent,
    installHidden: document.getElementById('install-nightly').hidden,
    installHref: document.getElementById('install-nightly').getAttribute('href'),
    selectHidden: document.getElementById('wallet-select').hidden,
    options: [...document.getElementById('wallet-select').options].map((o) => o.value),
  }))
  console.log('\n[' + label + ']')
  for (const [k, v] of Object.entries(s)) console.log('  ' + k.padEnd(14) + ': ' + JSON.stringify(v))
  return s
}

await page.goto(TARGET, { waitUntil: 'load' })

// The first render waits on the wallet-standard CDN, so wait until the app has decided.
await page.waitForFunction(
  () => document.getElementById('wallet-state').textContent !== 'Detecting wallets…',
  null,
  { timeout: 20000 },
)

const before = await snap('1. no extension yet')

// Simulate an extension injecting itself late — exactly what Nightly does.
await page.evaluate(() => {
  window.nightly = {
    solana: {
      name: 'Nightly',
      version: '1.0.0',
      chains: ['solana:mainnet', 'solana:devnet'],
      features: {
        'standard:connect': { connect: async () => ({ accounts: [] }) },
        'standard:disconnect': { disconnect: async () => {} },
      },
    },
  }
})

// The internal retries run at 150/400/1000/2500 ms after the first detection pass.
await page.waitForTimeout(5000)

const after = await snap('2. after window.nightly appears (no reload)')

console.log('\n' + '='.repeat(60))
const checks = [
  ['initial: state reports no wallet', before.state === 'No Solana wallet detected'],
  ['initial: Connect button hidden', before.connectHidden === true],
  ['initial: install link shown with correct href', before.installHidden === false && /nightly\.app/.test(before.installHref ?? '')],
  ['final: state becomes "Nightly detected"', after.state === 'Nightly detected'],
  ['final: Connect button visible again', after.connectHidden === false],
  ['final: button reads "Connect Nightly"', after.connectText === 'Connect Nightly'],
  ['final: install link hidden', after.installHidden === true],
  ['final: no console errors', consoleErrors.length === 0],
  ['final: no page errors', pageErrors.length === 0],
]
for (const [name, ok] of checks) console.log((ok ? 'PASS  ' : 'FAIL  ') + name)

if (consoleErrors.length) console.log('\nconsole errors:', consoleErrors.slice(0, 5))
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5))

const failed = checks.filter(([, ok]) => !ok).length
console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'))

await browser.close()
server?.kill()
process.exit(failed === 0 ? 0 : 1)
