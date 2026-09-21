// Drives the app in a real browser. The point is to prove the page actually populates with
// data, not merely that it parses — and to catch console errors and failed requests.
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

console.log('opening', URL)
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

// Wait until the network cards fill in (no longer showing "…").
await page
  .waitForFunction(
    () => {
      const cards = [...document.querySelectorAll('#net-cards .card .card-value')]
      return cards.length > 0 && cards.filter((c) => c.textContent.trim() !== '…').length >= 6
    },
    { timeout: 45000 },
  )
  .catch(() => console.log('!! network cards did not populate in time'))

const net = await page.$$eval('#net-cards .card', (cards) =>
  cards.map((c) => ({
    label: c.querySelector('.card-label')?.textContent?.trim(),
    value: c.querySelector('.card-value')?.textContent?.trim(),
    note: c.querySelector('.card-note')?.textContent?.trim() || '',
  })),
)

console.log('\n=== NETWORK CARDS ===')
for (const c of net) console.log(`  ${String(c.label).padEnd(18)} ${c.value}${c.note ? '   (' + c.note + ')' : ''}`)

const marketRows = await page.$$eval('#markets-table tbody tr', (r) => r.length)
const chartBars = await page.$$eval('#markets-chart svg rect.bar', (r) => r.length)
const marketSummary = await page.textContent('#markets-summary')
const venueOptions = await page.$$eval('#venue-filter option', (o) => o.length)

console.log('\n=== MARKETS ===')
console.log('  table rows    :', marketRows)
console.log('  chart bars    :', chartBars)
console.log('  venue options :', venueOptions)
console.log('  summary       :', marketSummary?.trim())

// Exercise token search (the /api/tokens/search endpoint).
await page.fill('#token-search', 'cook')
await page.waitForTimeout(2500)
const tokenRows = await page.$$eval('#tokens-table tbody tr', (r) => r.length)
const tokenSummary = await page.textContent('#tokens-summary')
console.log('\n=== TOKENS (search "cook") ===')
console.log('  rows          :', tokenRows)
console.log('  summary       :', tokenSummary?.trim())

// The venue filter must change the table contents.
await page.selectOption('#venue-filter', 'COOKIESWAP CPAMM')
await page.waitForTimeout(400)
const filtered = await page.$$eval('#markets-table tbody tr', (r) => r.length)
console.log('\n=== VENUE FILTER (COOKIESWAP CPAMM) ===')
console.log('  rows          :', filtered)

// ---------------------------------------------------------------------------
// Depth panel. Recompute the same figures here from the raw API and compare — a derived panel
// that quietly disagrees with the data it claims to derive from is worse than no panel at all.
// ---------------------------------------------------------------------------

const depthCards = await page.$$eval('#depth-cards .card', (cards) =>
  cards.map((c) => ({
    label: c.querySelector('.card-label')?.textContent?.trim(),
    value: c.querySelector('.card-value')?.textContent?.trim(),
    note: c.querySelector('.card-note')?.textContent?.trim() || '',
  })),
)

console.log('\n=== DEPTH CARDS (rendered) ===')
for (const c of depthCards) {
  console.log(`  ${String(c.label).padEnd(22)} ${String(c.value).padEnd(10)} ${c.note}`)
}

const rawMarkets = (await (await fetch('https://api.cookiescan.io/api/markets')).json()).markets
const rawStatus = await (await fetch('https://api.cookiescan.io/api/status')).json()

const rawLiq = rawMarkets.map((m) => (Number.isFinite(m.liquidityUsd) ? m.liquidityUsd : 0))
const rawTotal = rawLiq.reduce((a, b) => a + b, 0)
const rawRanked = rawLiq.slice().sort((a, b) => b - a)
const rawMints = new Set(
  rawMarkets.flatMap((m) => [m.baseToken?.mint, m.quoteToken?.mint]).filter(Boolean),
)

const expected = {
  'Top 5 concentration': ((rawRanked.slice(0, 5).reduce((a, b) => a + b, 0) / rawTotal) * 100).toFixed(1) + '%',
  'Dust pools': String(rawLiq.filter((v) => v < 1).length),
  'Mints with a pool': String(rawMints.size),
}
const rendered = Object.fromEntries(depthCards.map((c) => [c.label, c.value]))

console.log('\n=== DEPTH CROSS-CHECK (recomputed from the raw API) ===')
let depthMismatch = 0
for (const [label, want] of Object.entries(expected)) {
  const got = rendered[label]
  const ok = got === want
  if (!ok) depthMismatch++
  console.log(`  ${ok ? 'MATCH ' : 'DIFFER'}  ${label.padEnd(22)} page=${got}  recomputed=${want}`)
}
console.log('  indexed tokens reported by /api/status :', rawStatus.totalTokens)

// ---------------------------------------------------------------------------
// Message field: the visible field and the string that gets stamped must not drift apart.
// ---------------------------------------------------------------------------

console.log('\n=== MESSAGE FIELD ===')
const memoOf = async () => ((await page.textContent('#stamp-effective')) || '').trim()
const memoEmpty = await memoOf()
await page.fill('#stamp-text', 'hello chain')
await page.waitForTimeout(200)
const memoTyped = await memoOf()
await page.fill('#stamp-text', '')
await page.waitForTimeout(200)
const memoCleared = await memoOf()
console.log('  field empty    :', memoEmpty)
console.log('  after typing   :', memoTyped)
console.log('  cleared again  :', memoCleared)
console.log('  tracks input   :', memoTyped.includes('hello chain') ? 'yes' : 'NO')
console.log('  falls back     :', memoCleared === memoEmpty ? 'yes' : 'NO')

// Load the full directory (~3.9 MB). This path is the easiest to break silently.
console.log('\n=== LOAD FULL DIRECTORY ===')
const t0 = Date.now()
await page.click('#btn-load-tokens')
const loadOk = await page
  .waitForFunction(() => document.querySelector('#tokens-loading')?.hidden === true, { timeout: 90000 })
  .then(() => true)
  .catch(() => false)
const fullRows = await page.$$eval('#tokens-table tbody tr', (r) => r.length)
const fullSummary = await page.textContent('#tokens-summary')
const fullError = await page.$eval('#tokens-error', (n) => (n.hidden ? '' : n.textContent.trim()))
console.log('  done          :', loadOk, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)')
console.log('  rows          :', fullRows)
console.log('  summary       :', fullSummary?.trim())
console.log('  error         :', fullError || '(none)')

// Search must keep working after the full directory is loaded.
await page.fill('#token-search', 'bonk')
await page.waitForTimeout(2500)
console.log('  search "bonk" :', await page.$$eval('#tokens-table tbody tr', (r) => r.length), 'rows')

// Wallet state: with no extension the page must say so clearly rather than render blank.
const walletState = await page.textContent('#wallet-state')
const stampError = await page.textContent('#stamp-error')
console.log('\n=== WALLET ===')
console.log('  state         :', walletState?.trim())
console.log('  stamp message :', (stampError || '').trim().slice(0, 140))

const errorBanner = await page.$eval('#net-error', (n) => (n.hidden ? '' : n.textContent.trim()))
console.log('\n=== NETWORK ERROR BANNER ===')
console.log(' ', errorBanner || '(none)')

console.log('\n=== CONSOLE ERRORS (' + consoleErrors.length + ') ===')
consoleErrors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)))

console.log('\n=== PAGE ERRORS (' + pageErrors.length + ') ===')
pageErrors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)))

console.log('\n=== FAILED REQUESTS (' + failedRequests.length + ') ===')
failedRequests.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)))

await page.screenshot({ path: 'verify-shot.png', fullPage: true })
console.log('\n-> verify-shot.png')

await browser.close()
