// Finds an account that REALLY EXISTS on Cookie Chain, to use as the fee payer in simulation.
// Without one, simulateTransaction always aborts at AccountNotFound and proves nothing about
// our Memo instruction.
const RPC = 'https://rpc.cookiescan.io'

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25000),
  })
  const j = await res.json()
  if (j.error) throw new Error(method + ': ' + j.error.message)
  return j.result
}

// Take the most recent final block, then collect the fee payers from its transactions.
const epoch = await rpc('getEpochInfo')
const slot = epoch.absoluteSlot - 5

const payers = []
for (let s = slot; s > slot - 40 && payers.length < 5; s--) {
  try {
    const block = await rpc('getBlock', [
      s,
      { encoding: 'json', transactionDetails: 'full', rewards: false, maxSupportedTransactionVersion: 0 },
    ])
    if (!block?.transactions?.length) continue
    for (const t of block.transactions) {
      const keys = t.transaction?.message?.accountKeys
      if (!keys?.length) continue
      const payer = typeof keys[0] === 'string' ? keys[0] : keys[0]?.pubkey
      if (payer && !payers.includes(payer)) payers.push(payer)
    }
  } catch {
    // Empty or skipped slots are normal on a quiet chain.
  }
}

console.log('slots scanned around:', slot)
console.log('fee payers found    :', payers.length)
for (const p of payers) {
  try {
    const info = await rpc('getAccountInfo', [p, { encoding: 'base64' }])
    const v = info?.value
    console.log(`  ${p}  lamports=${v?.lamports ?? 0}  executable=${v?.executable ?? '-'}  owner=${(v?.owner ?? '-').slice(0, 20)}`)
  } catch (e) {
    console.log('  ' + p + '  FAILED: ' + e.message)
  }
}
