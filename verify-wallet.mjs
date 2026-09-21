// Membuktikan perbaikan deteksi wallet bekerja untuk kasus yang membuat user gagal:
// extension menyuntik window.nightly SETELAH app.js selesai jalan.
//
// Yang diuji:
//   1. Tanpa extension  -> UI menampilkan ajakan install, tombol Connect tersembunyi
//   2. window.nightly muncul belakangan -> UI harus pulih sendiri tanpa reload
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 8099
const TARGET = process.argv[2] || 'http://localhost:' + PORT + '/'
const server = TARGET.includes('localhost')
  ? spawn(process.execPath, ['dev-server.mjs', String(PORT)], { stdio: 'ignore' })
  : null
if (server) await new Promise((r) => setTimeout(r, 1200))
console.log('menguji:', TARGET)

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

// Render pertama menunggu CDN wallet-standard, jadi tunggu sampai app memutuskan.
await page.waitForFunction(
  () => document.getElementById('wallet-state').textContent !== 'Detecting wallets…',
  null,
  { timeout: 20000 },
)

const before = await snap('1. belum ada extension')

// Simulasi extension yang menyuntik dirinya terlambat — persis kasus user.
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

// Retry internal berjalan pada 150/400/1000/2500 ms setelah deteksi pertama.
await page.waitForTimeout(5000)

const after = await snap('2. setelah window.nightly muncul (tanpa reload)')

console.log('\n' + '='.repeat(60))
const checks = [
  ['awal: state bilang tidak terdeteksi', before.state === 'No Solana wallet detected'],
  ['awal: tombol Connect disembunyikan', before.connectHidden === true],
  ['awal: link Install terlihat + href benar', before.installHidden === false && /nightly\.app/.test(before.installHref ?? '')],
  ['akhir: state jadi "Nightly detected"', after.state === 'Nightly detected'],
  ['akhir: tombol Connect muncul lagi', after.connectHidden === false],
  ['akhir: teks tombol "Connect Nightly"', after.connectText === 'Connect Nightly'],
  ['akhir: link Install disembunyikan', after.installHidden === true],
  ['akhir: tidak ada error di console', consoleErrors.length === 0],
  ['akhir: tidak ada page error', pageErrors.length === 0],
]
for (const [name, ok] of checks) console.log((ok ? 'LULUS  ' : 'GAGAL  ') + name)

if (consoleErrors.length) console.log('\nconsole errors:', consoleErrors.slice(0, 5))
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5))

const failed = checks.filter(([, ok]) => !ok).length
console.log('\n' + (failed === 0 ? 'SEMUA LULUS' : failed + ' GAGAL'))

await browser.close()
server?.kill()
process.exit(failed === 0 ? 0 : 1)
