// Uji app di browser sungguhan. Tujuan: membuktikan halaman benar-benar mengisi data,
// bukan sekadar "tidak ada error sintaks". Tangkap console error + request gagal.
import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:8080/'

const browser = await chromium.launch()
const page = await browser.newPage()

const consoleErrors = []
const pageErrors = []
const failedRequests = []

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => pageErrors.push(err.message))
page.on('requestfailed', (req) => {
  failedRequests.push(req.url() + ' :: ' + (req.failure()?.errorText ?? '?'))
})

console.log('membuka', URL)
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

// Tunggu sampai kartu jaringan terisi (bukan "…" lagi).
await page
  .waitForFunction(
    () => {
      const cards = [...document.querySelectorAll('#net-cards .card .card-value')]
      return cards.length > 0 && cards.filter((c) => c.textContent.trim() !== '…').length >= 6
    },
    { timeout: 45000 },
  )
  .catch(() => console.log('!! kartu jaringan tidak terisi dalam batas waktu'))

const net = await page.$$eval('#net-cards .card', (cards) =>
  cards.map((c) => ({
    label: c.querySelector('.card-label')?.textContent?.trim(),
    value: c.querySelector('.card-value')?.textContent?.trim(),
    note: c.querySelector('.card-note')?.textContent?.trim() || '',
  })),
)

console.log('\n=== KARTU JARINGAN ===')
for (const c of net) console.log(`  ${String(c.label).padEnd(18)} ${c.value}${c.note ? '   (' + c.note + ')' : ''}`)

const marketRows = await page.$$eval('#markets-table tbody tr', (r) => r.length)
const chartBars = await page.$$eval('#markets-chart svg rect.bar', (r) => r.length)
const marketSummary = await page.textContent('#markets-summary')
const venueOptions = await page.$$eval('#venue-filter option', (o) => o.length)

console.log('\n=== PASAR ===')
console.log('  baris tabel   :', marketRows)
console.log('  batang chart  :', chartBars)
console.log('  opsi venue    :', venueOptions)
console.log('  ringkasan     :', marketSummary?.trim())

// Uji pencarian token (endpoint /api/tokens/search).
await page.fill('#token-search', 'cook')
await page.waitForTimeout(2500)
const tokenRows = await page.$$eval('#tokens-table tbody tr', (r) => r.length)
const tokenSummary = await page.textContent('#tokens-summary')
console.log('\n=== TOKEN (pencarian "cook") ===')
console.log('  baris         :', tokenRows)
console.log('  ringkasan     :', tokenSummary?.trim())

// Uji filter venue mengubah isi tabel.
await page.selectOption('#venue-filter', 'COOKIESWAP CPAMM')
await page.waitForTimeout(400)
const filtered = await page.$$eval('#markets-table tbody tr', (r) => r.length)
console.log('\n=== FILTER VENUE (COOKIESWAP CPAMM) ===')
console.log('  baris         :', filtered)

// Uji muat direktori penuh (~3,9 MB). Jalur ini paling mudah rusak diam-diam.
console.log('\n=== MUAT DIREKTORI PENUH ===')
const t0 = Date.now()
await page.click('#btn-load-tokens')
const loadOk = await page
  .waitForFunction(() => document.querySelector('#tokens-loading')?.hidden === true, { timeout: 90000 })
  .then(() => true)
  .catch(() => false)
const fullRows = await page.$$eval('#tokens-table tbody tr', (r) => r.length)
const fullSummary = await page.textContent('#tokens-summary')
const fullError = await page.$eval('#tokens-error', (n) => (n.hidden ? '' : n.textContent.trim()))
console.log('  selesai       :', loadOk, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)')
console.log('  baris         :', fullRows)
console.log('  ringkasan     :', fullSummary?.trim())
console.log('  error         :', fullError || '(tidak ada)')

// Setelah direktori penuh dimuat, pencarian harus tetap bekerja.
await page.fill('#token-search', 'bonk')
await page.waitForTimeout(2500)
console.log('  cari "bonk"   :', await page.$$eval('#tokens-table tbody tr', (r) => r.length), 'baris')

// Keadaan wallet: tanpa ekstensi harus muncul pesan jelas, bukan layar kosong.
const walletState = await page.textContent('#wallet-state')
const stampError = await page.textContent('#stamp-error')
console.log('\n=== WALLET ===')
console.log('  state         :', walletState?.trim())
console.log('  pesan stamp   :', (stampError || '').trim().slice(0, 140))

const errorBanner = await page.$eval('#net-error', (n) => (n.hidden ? '' : n.textContent.trim()))
console.log('\n=== BANNER ERROR JARINGAN ===')
console.log(' ', errorBanner || '(tidak ada)')

console.log('\n=== CONSOLE ERROR (' + consoleErrors.length + ') ===')
consoleErrors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)))

console.log('\n=== PAGE ERROR (' + pageErrors.length + ') ===')
pageErrors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)))

console.log('\n=== REQUEST GAGAL (' + failedRequests.length + ') ===')
failedRequests.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)))

await page.screenshot({ path: 'verify-shot.png', fullPage: true })
console.log('\n-> verify-shot.png')

await browser.close()
