/* Cookie Board — Cookie Chain intelligence dashboard + on-chain stamp.
 *
 * Design notes that matter:
 *  - No build step. Plain ES modules so the deployed artifact is exactly the source.
 *  - Solana libs come from a CDN, with a second CDN as fallback. A judge opening this
 *    page should not see a blank screen because one host was slow.
 *  - Everything read-only works with zero COOK in the wallet. Only the stamp needs COOK.
 *  - The Memo program id below was verified against Cookie Chain's genesis program list
 *    in the official docs, not copied from Solana mainnet folklore.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_HTTP = 'https://rpc.cookiescan.io'
const API_BASE = 'https://api.cookiescan.io'
const EXPLORER = 'https://cookiescan.io'
const BRIDGE_URL = 'https://hyperlane.cookiescan.io'
const NIGHTLY_URL = 'https://nightly.app'

// Memo program v1. Listed under "On-Chain Programs (Genesis)" in docs.cookiechain.wtf/ecosystem.
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

// COOK native mint, as reported by GET /api/status (cookMint).
const COOK_MINT = '36ZrtQoab5MhhySaP1YSTwUahSk6GRVUTtZ6cuVfm9e1'

// CAIP-2 chain id for Cookie Chain = "solana:" + first 32 chars of the genesis hash.
// Genesis hash 9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2 came from getGenesisHash.
const CHAIN_ID = 'solana:9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZ'

const WEB3_SOURCES = [
  'https://esm.sh/@solana/web3.js@1.98.4',
  'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.4/+esm',
]
const WALLET_STD_SOURCES = [
  'https://esm.sh/@wallet-standard/app@1.1.0',
  'https://cdn.jsdelivr.net/npm/@wallet-standard/app@1.1.0/+esm',
]

const NET_REFRESH_MS = 15000
const CHART_BARS = 12

// ---------------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id)

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function showError(node, message) {
  node.textContent = message
  node.hidden = false
}

function clearError(node) {
  node.textContent = ''
  node.hidden = true
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtInt(n) {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/** Prices here range from ~1e-9 to ~1e4, so fixed decimals would either lie or be unreadable. */
function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return '$' + n.toFixed(2)
  if (abs >= 0.001) return '$' + n.toFixed(6)
  return '$' + n.toExponential(3)
}

function fmtCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '—'
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [size, suffix] of units) {
    if (Math.abs(n) >= size) return (n / size).toFixed(2).replace(/\.?0+$/, '') + suffix
  }
  return n.toFixed(2)
}

function shortAddr(a, head = 6, tail = 5) {
  if (typeof a !== 'string' || a.length <= head + tail + 2) return a || '—'
  return a.slice(0, head) + '…' + a.slice(-tail)
}

function explorerAddr(a) {
  return EXPLORER + '/address/' + a
}
function explorerTx(sig) {
  return EXPLORER + '/tx/' + sig
}

// ---------------------------------------------------------------------------
// Lazy module loading with fallback host
// ---------------------------------------------------------------------------

const moduleCache = new Map()

async function loadModule(sources) {
  const key = sources[0]
  if (moduleCache.has(key)) return moduleCache.get(key)

  let lastErr = null
  for (const url of sources) {
    try {
      const mod = await import(/* @vite-ignore */ url)
      moduleCache.set(key, mod)
      return mod
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error('Could not load dependency from any CDN: ' + (lastErr?.message ?? 'unknown'))
}

let web3Promise = null
function getWeb3() {
  if (!web3Promise) web3Promise = loadModule(WEB3_SOURCES)
  return web3Promise
}

// ---------------------------------------------------------------------------
// JSON fetch helpers (API + RPC)
// ---------------------------------------------------------------------------

async function fetchJson(url, { timeout = 20000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url)
  return res.json()
}

const api = (path) => fetchJson(API_BASE + path)

let rpcId = 1
async function rpc(method, params = [], { timeout = 20000 } = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params })
  const res = await fetch(RPC_HTTP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error('RPC HTTP ' + res.status)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || 'RPC error')
  return json.result
}

// ---------------------------------------------------------------------------
// Network panel
// ---------------------------------------------------------------------------

let lastPerf = null

function statCard(label, value, note) {
  const card = el('div', 'card')
  card.append(el('div', 'card-label', label))
  card.append(el('div', 'card-value', value))
  if (note) card.append(el('div', 'card-note', note))
  return card
}

function pendingCard(label) {
  const card = statCard(label, '…')
  card.classList.add('is-pending')
  return card
}

const NET_CARDS = [
  ['Health', 'health'],
  ['Slot', 'slot'],
  ['Epoch', 'epoch'],
  ['Block height', 'blockHeight'],
  ['Transactions', 'txCount'],
  ['Real TPS', 'tps'],
  ['COOK price', 'cookUsd'],
  ['Active tokens', 'activeTokens'],
  ['Liquidity markets', 'marketCount'],
  ['Indexed metadata', 'metadataCached'],
]

function renderNetSkeleton() {
  const box = $('net-cards')
  box.replaceChildren(...NET_CARDS.map(([, key]) => {
    const card = pendingCard(key)
    card.dataset.key = key
    return card
  }))
}

function fillNetCard(key, value, note) {
  const box = $('net-cards')
  const card = box.querySelector('[data-key="' + key + '"]')
  if (!card) return
  card.classList.remove('is-pending')
  card.querySelector('.card-value').textContent = value
  const existing = card.querySelector('.card-note')
  if (note) {
    if (existing) existing.textContent = note
    else card.append(el('div', 'card-note', note))
  } else if (existing) {
    existing.remove()
  }
}

async function loadNetwork() {
  clearError($('net-error'))
  renderNetSkeleton()

  // Status + markets come from the index; slot/epoch/health come straight from the chain.
  // They are independent, so a failure in one should not blank the other.
  const [statusR, epochR, healthR, perfR, marketsR] = await Promise.allSettled([
    api('/api/status'),
    rpc('getEpochInfo'),
    rpc('getHealth'),
    rpc('getRecentPerformanceSamples', [5]),
    api('/api/markets'),
  ])

  const failures = []
  const status = statusR.status === 'fulfilled' ? statusR.value : (failures.push('status index'), null)
  const epoch = epochR.status === 'fulfilled' ? epochR.value : (failures.push('epoch'), null)
  const health = healthR.status === 'fulfilled' ? healthR.value : (failures.push('health'), null)
  const perf = perfR.status === 'fulfilled' ? perfR.value : (failures.push('performance'), null)
  const markets = marketsR.status === 'fulfilled' ? marketsR.value : (failures.push('markets'), null)

  if (health !== null) {
    fillNetCard('health', String(health).toUpperCase())
  }

  if (epoch) {
    fillNetCard('slot', fmtInt(epoch.absoluteSlot))
    fillNetCard('epoch', fmtInt(epoch.epoch), 'slot ' + fmtInt(epoch.slotIndex) + ' / ' + fmtInt(epoch.slotsInEpoch))
    fillNetCard('blockHeight', fmtInt(epoch.blockHeight))
    fillNetCard('txCount', fmtCompact(epoch.transactionCount), 'lifetime')
  }

  if (Array.isArray(perf) && perf.length) {
    lastPerf = perf
    const totals = perf.reduce(
      (acc, s) => {
        acc.tx += s.numTransactions || 0
        acc.secs += s.samplePeriodSecs || 0
        acc.slots += s.numSlots || 0
        return acc
      },
      { tx: 0, secs: 0, slots: 0 },
    )
    const tps = totals.secs ? totals.tx / totals.secs : NaN
    const nonVote = perf.reduce((a, s) => a + (s.numNonVoteTransactions || 0), 0)
    fillNetCard('tps', Number.isFinite(tps) ? tps.toFixed(2) : '—', nonVote + ' non-vote tx in window')
  }

  if (status) {
    fillNetCard('cookUsd', fmtUsd(status.cookUsd))
    fillNetCard('activeTokens', fmtInt(status.activeTokens))
    fillNetCard('metadataCached', fmtInt(status.metadataCached))
  }

  if (markets) {
    fillNetCard('marketCount', fmtInt(markets.marketCount))
    renderMarkets(markets)
  }

  $('net-updated').textContent = 'updated ' + new Date().toLocaleTimeString()

  if (failures.length) {
    showError($('net-error'), 'Some sources did not respond: ' + failures.join(', ') + '. Values shown are partial.')
  }
}

// ---------------------------------------------------------------------------
// Markets panel
// ---------------------------------------------------------------------------

let allMarkets = []

function renderMarketsChart(markets) {
  const box = $('markets-chart')
  box.replaceChildren()

  const top = markets
    .filter((m) => Number.isFinite(m.liquidityUsd) && m.liquidityUsd > 0)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
    .slice(0, CHART_BARS)

  if (!top.length) {
    box.append(el('div', 'empty', 'No market reports liquidity above zero right now.'))
    return
  }

  const rowH = 24
  const labelW = 150
  const valueW = 92
  const width = 720
  const chartW = width - labelW - valueW
  const height = top.length * rowH + 10
  const max = top[0].liquidityUsd

  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('role', 'img')

  top.forEach((m, i) => {
    const y = i * rowH + 5
    const pair = `${m.baseToken?.symbol ?? '?'} / ${m.quoteToken?.symbol ?? '?'}`
    const w = Math.max(2, (m.liquidityUsd / max) * (chartW - 6))

    const label = document.createElementNS(NS, 'text')
    label.setAttribute('x', '0')
    label.setAttribute('y', String(y + 13))
    label.textContent = pair.length > 22 ? pair.slice(0, 21) + '…' : pair
    svg.append(label)

    const bar = document.createElementNS(NS, 'rect')
    bar.setAttribute('class', 'bar')
    bar.setAttribute('x', String(labelW))
    bar.setAttribute('y', String(y + 2))
    bar.setAttribute('width', String(w))
    bar.setAttribute('height', String(rowH - 8))
    bar.setAttribute('rx', '3')
    const title = document.createElementNS(NS, 'title')
    title.textContent = `${pair} — ${fmtUsd(m.liquidityUsd)} (${m.type})`
    bar.append(title)
    svg.append(bar)

    const value = document.createElementNS(NS, 'text')
    value.setAttribute('x', String(labelW + w + 8))
    value.setAttribute('y', String(y + 13))
    value.textContent = fmtUsd(m.liquidityUsd)
    svg.append(value)
  })

  box.append(svg)
}

function marketRow(m) {
  const tr = document.createElement('tr')

  const pair = document.createElement('td')
  const base = m.baseToken?.symbol ?? '?'
  const quote = m.quoteToken?.symbol ?? '?'
  pair.append(el('span', 'sym', `${base} / ${quote}`))
  tr.append(pair)

  const venue = document.createElement('td')
  venue.append(el('span', 'pill', m.type || '—'))
  tr.append(venue)

  const liq = el('td', 'num', m.liquidityUsd > 0 ? fmtUsd(m.liquidityUsd) : '—')
  if (!(m.liquidityUsd > 0)) liq.classList.add('zero')
  tr.append(liq)

  tr.append(el('td', '', m.liquidityDisplay || '—'))

  const id = el('td', 'addr')
  const link = el('a', '', shortAddr(m.marketId))
  link.href = explorerAddr(m.marketId)
  link.target = '_blank'
  link.rel = 'noreferrer noopener'
  id.append(link)
  tr.append(id)

  return tr
}

function applyMarketView() {
  const venue = $('venue-filter').value
  const sort = $('market-sort').value

  let rows = allMarkets.filter((m) => !venue || m.type === venue)

  rows = rows.slice().sort((a, b) => {
    if (sort === 'base') return (b.baseToken?.priceUsd ?? 0) - (a.baseToken?.priceUsd ?? 0)
    if (sort === 'quote') return (b.quoteToken?.priceUsd ?? 0) - (a.quoteToken?.priceUsd ?? 0)
    return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)
  })

  const tbody = $('markets-table').querySelector('tbody')
  tbody.replaceChildren(...rows.map(marketRow))
}

function renderMarkets(payload) {
  allMarkets = Array.isArray(payload.markets) ? payload.markets : []

  const totalLiq = allMarkets.reduce((a, m) => a + (m.liquidityUsd || 0), 0)
  const withLiq = allMarkets.filter((m) => m.liquidityUsd > 0).length
  $('markets-summary').textContent =
    `${fmtInt(allMarkets.length)} markets · ${fmtInt(withLiq)} with liquidity · ${fmtUsd(totalLiq)} total`

  const venues = [...new Set(allMarkets.map((m) => m.type).filter(Boolean))].sort()
  const select = $('venue-filter')
  const current = select.value
  select.replaceChildren(el('option', '', 'All venues'))
  select.firstChild.value = ''
  for (const v of venues) {
    const opt = el('option', '', v)
    opt.value = v
    select.append(opt)
  }
  select.value = current

  renderMarketsChart(allMarkets)
  applyMarketView()
  clearError($('markets-error'))
}

// ---------------------------------------------------------------------------
// Tokens panel
// ---------------------------------------------------------------------------

let tokenRows = []

/**
 * Most token logos in the index are IPFS links pointing at ipfs.io. That host rate-limits
 * aggressively and answers with a Cross-Origin-Resource-Policy that makes browsers refuse the
 * image outright (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin). Both gateways below were checked to
 * serve with Access-Control-Allow-Origin: * and no blocking CORP header, so <img> can load them.
 */
const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.filebase.io/ipfs/',
]

/** Turns an ipfs:// or gateway URL into an ordered list of browser-loadable URLs. */
function logoSources(raw) {
  if (!raw) return []
  const fromGateway = raw.match(/\/ipfs\/([^/?#]+)/)?.[1]
  const cid = fromGateway ?? (raw.startsWith('ipfs://') ? raw.slice('ipfs://'.length) : null)
  if (!cid) return [raw]
  return IPFS_GATEWAYS.map((gateway) => gateway + cid)
}

function tokenRow(t) {
  const tr = document.createElement('tr')

  const nameCell = document.createElement('td')
  const wrap = el('div', 'token-cell')
  const monogram = () =>
    el('div', 'token-logo-fallback', (t.metadata?.symbol ?? '?').slice(0, 2).toUpperCase())

  const sources = logoSources(t.metadata?.logo)
  if (sources.length) {
    const img = el('img', 'token-logo')
    img.alt = ''
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    let attempt = 0
    img.src = sources[attempt]
    // Walk the gateway list, then give up gracefully — dead metadata is the norm here.
    img.addEventListener('error', () => {
      attempt += 1
      if (attempt < sources.length) img.src = sources[attempt]
      else img.replaceWith(monogram())
    })
    wrap.append(img)
  } else {
    wrap.append(monogram())
  }
  const names = el('div')
  names.append(el('div', 'sym', t.metadata?.symbol ?? '—'))
  names.append(el('div', 'muted small', t.metadata?.name ?? ''))
  wrap.append(names)
  nameCell.append(wrap)
  tr.append(nameCell)

  const mintCell = el('td', 'addr')
  const mintLink = el('a', '', shortAddr(t.mint, 8, 6))
  mintLink.href = explorerAddr(t.mint)
  mintLink.target = '_blank'
  mintLink.rel = 'noreferrer noopener'
  mintCell.append(mintLink)
  tr.append(mintCell)

  const price = t.price?.usd ?? 0
  const priceCell = el('td', 'num', price > 0 ? fmtUsd(price) : '—')
  if (!(price > 0)) priceCell.classList.add('zero')
  tr.append(priceCell)

  const mc = t.marketData?.marketCap ?? 0
  const mcCell = el('td', 'num', mc > 0 ? '$' + fmtCompact(mc) : '—')
  if (!(mc > 0)) mcCell.classList.add('zero')
  tr.append(mcCell)

  const liq = t.marketData?.liquidity ?? 0
  const liqCell = el('td', 'num', liq > 0 ? fmtUsd(liq) : '—')
  if (!(liq > 0)) liqCell.classList.add('zero')
  tr.append(liqCell)

  const holders = t.marketData?.holderCount ?? 0
  const hCell = el('td', 'num', holders > 0 ? fmtInt(holders) : '—')
  if (!(holders > 0)) hCell.classList.add('zero')
  tr.append(hCell)

  return tr
}

function renderTokenRows(rows, { note, emptyMessage } = {}) {
  const tbody = $('tokens-table').querySelector('tbody')

  if (!rows.length) {
    const tr = document.createElement('tr')
    const td = el('td', 'muted', emptyMessage || 'No tokens to show.')
    td.colSpan = 6
    td.style.padding = '18px 12px'
    tr.append(td)
    tbody.replaceChildren(tr)
    $('tokens-summary').textContent = ''
    return
  }

  tbody.replaceChildren(...rows.map(tokenRow))
  $('tokens-summary').textContent =
    `${fmtInt(rows.length)} shown` + (note ? ' · ' + note : '')
}

function sortTokensForDisplay(rows) {
  // Surface the ones with real market data first — the long tail is 6k dead memecoins.
  return rows.slice().sort((a, b) => {
    const am = a.marketData?.marketCap ?? 0
    const bm = b.marketData?.marketCap ?? 0
    if (bm !== am) return bm - am
    const al = a.marketData?.liquidity ?? 0
    const bl = b.marketData?.liquidity ?? 0
    return bl - al
  })
}

let searchTimer = null

async function runTokenSearch(q) {
  clearError($('tokens-error'))
  const query = q.trim()

  if (!query) {
    renderTokenRows([], { emptyMessage: 'Type a symbol or name to search the Cookie Chain token index.' })
    return
  }

  try {
    const res = await api('/api/tokens/search?q=' + encodeURIComponent(query))
    const rows = Array.isArray(res.data) ? res.data : []
    renderTokenRows(sortTokensForDisplay(rows), {
      note: 'indexed search',
      // A zero here is a real answer, not a failure — plenty of Solana tokens have no
      // Cookie Chain counterpart, so say that instead of leaving a blank table.
      emptyMessage: `No token on Cookie Chain matches “${query}”.`,
    })
  } catch (err) {
    showError($('tokens-error'), 'Search failed: ' + err.message)
  }
}

async function loadFullDirectory() {
  const btn = $('btn-load-tokens')
  const loading = $('tokens-loading')
  btn.disabled = true
  loading.hidden = false
  clearError($('tokens-error'))

  try {
    const res = await api('/api/tokens', { timeout: 60000 })
    const rows = Array.isArray(res.data) ? res.data : []
    tokenRows = sortTokensForDisplay(rows)
    renderTokenRows(tokenRows.slice(0, 200), { note: 'top 200 by market cap of ' + fmtInt(rows.length) })
    btn.textContent = 'Reload full directory'
  } catch (err) {
    showError($('tokens-error'), 'Could not load the full directory: ' + err.message)
  } finally {
    btn.disabled = false
    loading.hidden = true
  }
}

// ---------------------------------------------------------------------------
// Wallet layer (Solana Wallet Standard; Nightly is the documented path)
// ---------------------------------------------------------------------------

const wallet = {
  available: [],
  selected: null,
  account: null,
}

function isWalletLike(obj) {
  return Boolean(obj && obj.features && obj.features['standard:connect'])
}

let walletRegistry = null

/** Registry is a bonus, not a requirement — window.nightly alone is enough. */
async function getWalletRegistry() {
  if (walletRegistry) return walletRegistry
  try {
    const mod = await loadModule(WALLET_STD_SOURCES)
    walletRegistry = mod.getWallets()
  } catch {
    walletRegistry = null
  }
  return walletRegistry
}

async function detectWallets() {
  const found = []
  const seen = new Set()

  // Documented Nightly path: window.nightly.solana.
  const nightly = window.nightly?.solana
  if (isWalletLike(nightly)) {
    found.push({ name: 'Nightly', source: nightly })
    seen.add('Nightly')
  }

  // Wallet Standard registry picks up every compliant extension, Nightly included.
  const registry = await getWalletRegistry()
  if (registry) {
    for (const w of registry.get()) {
      if (seen.has(w.name)) continue
      if (!isWalletLike(w)) continue
      const chains = w.chains || []
      const solanaish = chains.length === 0 || chains.some((c) => String(c).startsWith('solana:'))
      if (!solanaish) continue
      found.push({ name: w.name, source: w })
      seen.add(w.name)
    }
  }

  return found
}

function setWalletState(text, kind) {
  const node = $('wallet-state')
  node.textContent = text
  node.classList.toggle('is-connected', kind === 'connected')
  node.classList.toggle('is-error', kind === 'error')
}

/** standard:connect resolves to { accounts } per the spec, but some builds return the array directly. */
function accountsFromConnectResult(result) {
  if (Array.isArray(result)) return result
  if (result && Array.isArray(result.accounts)) return result.accounts
  return []
}

async function connectWallet(entry) {
  if (!entry) return
  clearError($('stamp-error'))
  setWalletState('Requesting permission…')

  try {
    const connect = entry.source.features['standard:connect'].connect
    const accounts = accountsFromConnectResult(await connect.call(entry.source.features['standard:connect']))
    const account = accounts[0]
    if (!account) throw new Error('Wallet returned no accounts. Unlock Nightly and try again.')

    wallet.selected = entry
    wallet.account = account
    await onWalletConnected()
  } catch (err) {
    wallet.selected = null
    wallet.account = null
    setWalletState('Connection failed', 'error')
    showError($('stamp-error'), 'Could not connect: ' + (err?.message ?? err))
    updateWalletButtons()
  }
}

async function onWalletConnected() {
  const address = wallet.account.address
  setWalletState('Connected ' + shortAddr(address, 8, 6), 'connected')
  updateWalletButtons()
  // refreshBalance owns the stamp button: it is the only thing that knows whether this wallet
  // can pay a fee. Re-enabling it here afterwards would override the zero-balance guard.
  await refreshBalance()
}

async function refreshBalance() {
  if (!wallet.account) return
  try {
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = await getWeb3()
    const connection = new Connection(RPC_HTTP, 'confirmed')
    const lamports = await connection.getBalance(new PublicKey(wallet.account.address))
    const cook = lamports / LAMPORTS_PER_SOL
    setWalletState(
      `Connected ${shortAddr(wallet.account.address, 8, 6)} · ${cook.toLocaleString('en-US', { maximumFractionDigits: 6 })} COOK`,
      'connected',
    )
    if (lamports === 0) {
      showError(
        $('stamp-error'),
        'This wallet holds 0 COOK, so it cannot pay a network fee yet. The dashboard above works without any COOK. ' +
          'To use the stamp, bridge a small amount of COOK at ' + BRIDGE_URL + ' first.',
      )
      $('btn-stamp').disabled = true
    } else {
      clearError($('stamp-error'))
      $('btn-stamp').disabled = false
    }
  } catch (err) {
    setWalletState('Connected ' + shortAddr(wallet.account.address, 8, 6) + ' · balance unavailable', 'connected')
    // Without a known balance the stamp could only produce a transaction that fails on chain,
    // so keep it disabled rather than letting someone sign for nothing.
    showError(
      $('stamp-error'),
      'Could not read this wallet’s COOK balance, so the stamp stays disabled — it cannot pay a ' +
        'network fee without it. Reconnect to try again. (' + err.message + ')',
    )
    $('btn-stamp').disabled = true
  }
}

async function disconnectWallet() {
  try {
    const feat = wallet.selected?.source?.features?.['standard:disconnect']
    if (feat?.disconnect) await feat.disconnect.call(feat)
  } catch {
    // A wallet that refuses to disconnect is not worth an error banner.
  }
  wallet.account = null
  setWalletState('Disconnected')
  updateWalletButtons()
  $('btn-stamp').disabled = true
  $('stamp-result').hidden = true
  clearError($('stamp-error'))
}

function updateWalletButtons() {
  const connected = Boolean(wallet.account)
  $('btn-connect').hidden = connected || !wallet.selected
  $('btn-disconnect').hidden = !connected
  $('wallet-select').hidden = connected || wallet.available.length < 2
}

function renderWalletUi() {
  const select = $('wallet-select')
  const connect = $('btn-connect')
  const install = $('install-nightly')

  select.replaceChildren()
  for (const w of wallet.available) {
    const opt = el('option', '', w.name)
    opt.value = w.name
    select.append(opt)
  }

  if (!wallet.available.length) {
    setWalletState('No Solana wallet detected')
    connect.hidden = true
    select.hidden = true
    install.href = NIGHTLY_URL
    install.hidden = false
    return
  }

  install.hidden = true
  clearError($('stamp-error'))

  // Nightly first — it is the wallet the bounty asks for.
  const preferred = wallet.available.find((w) => w.name === 'Nightly') ?? wallet.available[0]
  select.value = preferred.name
  wallet.selected = preferred

  connect.hidden = false
  connect.textContent = 'Connect ' + preferred.name
  select.hidden = wallet.available.length < 2
  setWalletState(preferred.name + ' detected')
}

async function initWallets() {
  wallet.available = await detectWallets()
  renderWalletUi()

  // Extensions inject window.nightly on their own schedule — often after this module
  // has already run. The registry announces wallets as they appear; the retries below
  // cover a wallet that only ever shows up on window.nightly.
  const registry = await getWalletRegistry()
  registry?.on?.('register', async () => {
    if (wallet.account) return
    wallet.available = await detectWallets()
    if (wallet.available.length) renderWalletUi()
  })

  if (wallet.available.length) return

  for (const delay of [150, 400, 1000, 2500]) {
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (wallet.account) return
    wallet.available = await detectWallets()
    if (wallet.available.length) {
      renderWalletUi()
      return
    }
  }
}

// ---------------------------------------------------------------------------
// On-chain stamp
// ---------------------------------------------------------------------------

const STEPS = ['build', 'sign', 'send', 'confirm']

function resetSteps() {
  for (const s of STEPS) {
    const li = document.querySelector(`.steps li[data-step="${s}"]`)
    li.classList.remove('is-active', 'is-done', 'is-failed')
  }
}

function markStep(step, state) {
  const li = document.querySelector(`.steps li[data-step="${step}"]`)
  if (!li) return
  li.classList.remove('is-active', 'is-done', 'is-failed')
  li.classList.add(state)
}

/**
 * Sends one Memo instruction on Cookie Chain.
 *
 * Ordering matters: the blockhash has to come from Cookie Chain's RPC, and the wallet
 * must sign the exact bytes we broadcast — so we serialize locally and hand the bytes
 * to the wallet rather than letting it build its own transaction.
 */
/**
 * Signing features belong to the WalletAccount per the standard, but some wallets publish them
 * on the Wallet instead — Nightly does exactly that (`window.nightly.solana.features` carries
 * signAndSendTransaction and signTransaction). A feature taken from the Wallet needs its account
 * passed in explicitly, which is what `needsAccount` records.
 */
function signingFeature(name) {
  const onAccount = wallet.account?.features?.[name]
  if (onAccount) return { feature: onAccount, needsAccount: false }
  const onWallet = wallet.selected?.source?.features?.[name]
  if (onWallet) return { feature: onWallet, needsAccount: true }
  return null
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Base58 encoding, matching the reference bs58 implementation. */
function bytesToBase58(bytes) {
  const source = Array.from(bytes)
  if (source.length === 0) return ''

  const digits = [0]
  for (let i = 0; i < source.length; i++) {
    let carry = source[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }

  let out = ''
  for (let k = 0; source[k] === 0 && k < source.length - 1; k++) out += BASE58_ALPHABET[0]
  for (let q = digits.length - 1; q >= 0; q--) out += BASE58_ALPHABET[digits[q]]
  return out
}

/**
 * Wallets disagree about this one field. The standard says signAndSendTransaction returns the
 * signature as raw bytes, and Phantom does exactly that; Nightly returns a base58 string.
 * confirmTransaction and the explorer link only accept text, so normalise here instead of at
 * every call site.
 */
function normalizeSignature(value) {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array || Array.isArray(value)) return bytesToBase58(value)
  return null
}

async function stamp() {
  const btn = $('btn-stamp')
  const resultBox = $('stamp-result')

  if (!wallet.account) {
    showError($('stamp-error'), 'Connect a wallet first.')
    return
  }

  const text = ($('stamp-text').value || '').trim() || 'gm from Cookie Board'
  if (text.length > 120) {
    showError($('stamp-error'), 'Memo must be 120 characters or fewer.')
    return
  }

  btn.disabled = true
  resultBox.hidden = true
  clearError($('stamp-error'))
  resetSteps()

  let connection = null
  let signature = null

  try {
    const { Connection, PublicKey, Transaction, TransactionInstruction } = await getWeb3()
    connection = new Connection(RPC_HTTP, 'confirmed')

    // ---- build
    markStep('build', 'is-active')
    const signer = new PublicKey(wallet.account.address)
    const memoIx = new TransactionInstruction({
      keys: [{ pubkey: signer, isSigner: true, isWritable: true }],
      programId: new PublicKey(MEMO_PROGRAM_ID),
      data: new TextEncoder().encode(text),
    })

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction().add(memoIx)
    tx.feePayer = signer
    tx.recentBlockhash = blockhash
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
    markStep('build', 'is-done')

    // ---- sign + send
    markStep('sign', 'is-active')
    const chain = wallet.account.chains?.[0] ?? CHAIN_ID
    const signAndSend = signingFeature('solana:signAndSendTransaction')

    if (signAndSend) {
      const input = { transaction: serialized, chain, options: { skipPreflight: false } }
      if (signAndSend.needsAccount) input.account = wallet.account
      const outputs = await signAndSend.feature.signAndSendTransaction(input)
      const first = Array.isArray(outputs) ? outputs[0] : outputs
      signature = normalizeSignature(first?.signature ?? first)
      if (!signature) throw new Error('Wallet returned no signature.')
      markStep('sign', 'is-done')
      markStep('send', 'is-done')
    } else {
      // Fallback for wallets that only expose signing.
      const sign = signingFeature('solana:signTransaction')
      if (!sign) throw new Error('This wallet exposes neither signAndSendTransaction nor signTransaction.')
      const input = { transaction: serialized, chain }
      if (sign.needsAccount) input.account = wallet.account
      const outputs = await sign.feature.signTransaction(input)
      const signed = (Array.isArray(outputs) ? outputs[0] : outputs)?.signedTransaction
      if (!signed) throw new Error('Wallet returned no signed transaction.')
      markStep('sign', 'is-done')

      markStep('send', 'is-active')
      signature = await connection.sendRawTransaction(signed, { skipPreflight: false })
      markStep('send', 'is-done')
    }

    // ---- confirm
    markStep('confirm', 'is-active')
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    )

    if (confirmation?.value?.err) {
      throw new Error('Transaction landed with an error: ' + JSON.stringify(confirmation.value.err))
    }

    markStep('confirm', 'is-done')

    const link = el('a', '', signature)
    link.href = explorerTx(signature)
    link.target = '_blank'
    link.rel = 'noreferrer noopener'

    resultBox.replaceChildren()
    resultBox.append(el('div', '', 'Confirmed on Cookie Chain.'))
    const sigLine = el('div', 'sig')
    sigLine.append(document.createTextNode('Signature: '))
    sigLine.append(link)
    resultBox.append(sigLine)
    resultBox.append(el('div', 'muted small', 'Memo: ' + text))
    resultBox.hidden = false
    await refreshBalance()
  } catch (err) {
    const message = String(err?.message ?? err)
    const active = document.querySelector('.steps li.is-active')
    if (active) {
      active.classList.remove('is-active')
      active.classList.add('is-failed')
    }
    if (/user rejected|rejected by user|denied/i.test(message)) {
      showError($('stamp-error'), 'You rejected the signature request. Nothing was sent.')
    } else if (/insufficient|0x1|lamports/i.test(message)) {
      showError($('stamp-error'), 'Not enough COOK to cover the network fee. Bridge a small amount at ' + BRIDGE_URL + '.')
    } else {
      showError($('stamp-error'), 'Stamp failed: ' + message)
    }
  } finally {
    btn.disabled = !wallet.account
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function bind() {
  $('btn-connect').addEventListener('click', () => {
    const name = $('wallet-select').value
    const entry = wallet.available.find((w) => w.name === name) ?? wallet.selected
    connectWallet(entry)
  })

  $('wallet-select').addEventListener('change', (e) => {
    wallet.selected = wallet.available.find((w) => w.name === e.target.value) ?? null
    $('btn-connect').textContent = 'Connect ' + (wallet.selected?.name ?? 'wallet')
  })

  $('btn-disconnect').addEventListener('click', disconnectWallet)
  $('btn-stamp').addEventListener('click', stamp)
  $('btn-load-tokens').addEventListener('click', loadFullDirectory)

  $('venue-filter').addEventListener('change', applyMarketView)
  $('market-sort').addEventListener('change', applyMarketView)

  $('token-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer)
    const value = e.target.value
    searchTimer = setTimeout(() => runTokenSearch(value), 320)
  })

  $('bridge-link').href = BRIDGE_URL
}

async function main() {
  bind()
  resetSteps()
  renderNetSkeleton()

  await Promise.allSettled([loadNetwork(), initWallets()])

  setInterval(() => {
    if (!document.hidden) loadNetwork()
  }, NET_REFRESH_MS)
}

main()
