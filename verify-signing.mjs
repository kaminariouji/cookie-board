// Membuktikan perbaikan jalur signing: Nightly menaruh fitur tanda tangan di level WALLET
// (`window.nightly.solana.features`), sedangkan kode lama hanya mencarinya di level ACCOUNT.
//
// Uji ini menyuntik wallet tiruan yang meniru struktur itu — account TANPA `features` — lalu
// memastikan tombol Stamp benar-benar memanggil signAndSendTransaction, dan memanggilnya dengan
// `account` disertakan (syarat varian fitur level wallet).
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 8098
const TARGET = process.argv[2] || 'http://localhost:' + PORT + '/'
const server = TARGET.includes('localhost')
  ? spawn(process.execPath, ['dev-server.mjs', String(PORT)], { stdio: 'ignore' })
  : null
if (server) await new Promise((r) => setTimeout(r, 1200))
console.log('menguji:', TARGET)

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

// Wallet tiruan: fitur tanda tangan hanya ada di level wallet, bukan di account.
await page.evaluate(() => {
  window.__stampCalls = []
  const account = {
    address: 'DL9GPSXrhAEnU5Ads3HLhEJ9fCDLpnmmkzxoe712W4xP',
    publicKey: new Uint8Array(32),
    chains: ['solana:mainnet'],
    features: {}, // <- kosong, persis seperti yang dikembalikan Nightly
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

// Wallet muncul belakangan -> UI harus pulih sendiri.
await page.waitForFunction(
  () => document.getElementById('wallet-state').textContent === 'Nightly detected',
  null,
  { timeout: 20000 },
)
console.log('wallet terdeteksi     : ya')

await page.click('#btn-connect')
await page.waitForFunction(
  () => /^Connected/.test(document.getElementById('wallet-state').textContent),
  null,
  { timeout: 20000 },
)
console.log('connect               :', (await page.textContent('#wallet-state')).trim())

// Akun uji ini tidak punya COOK, jadi tombolnya dinonaktifkan refreshBalance. Untuk menguji
// jalur signing saja, aktifkan kembali.
await page.evaluate(() => { document.getElementById('btn-stamp').disabled = false })
await page.click('#btn-stamp')

await page.waitForFunction(() => window.__stampCalls.length > 0, null, { timeout: 30000 }).catch(() => {})
const calls = await page.evaluate(() => window.__stampCalls)
const stampError = await page.$eval('#stamp-error', (n) => (n.hidden ? '' : n.textContent.trim()))

console.log('\npanggilan ke wallet   :', JSON.stringify(calls))
console.log('pesan error stamp     :', stampError || '(tidak ada)')

console.log('\n' + '='.repeat(60))
const checks = [
  ['signAndSendTransaction benar-benar dipanggil', calls.length === 1],
  ['dipanggil dengan account disertakan', calls[0]?.hasAccount === true],
  ['account yang dikirim alamat yang benar', calls[0]?.accountAddress === 'DL9GPSXrhAEnU5Ads3HLhEJ9fCDLpnmmkzxoe712W4xP'],
  ['tidak muncul error "exposes neither"', !/exposes neither/.test(stampError)],
  ['tidak ada page error', pageErrors.length === 0],
]
for (const [name, ok] of checks) console.log((ok ? 'LULUS  ' : 'GAGAL  ') + name)

const failed = checks.filter(([, ok]) => !ok).length
console.log('\n' + (failed === 0 ? 'SEMUA LULUS' : failed + ' GAGAL'))

await browser.close()
server?.kill()
process.exit(failed === 0 ? 0 : 1)
