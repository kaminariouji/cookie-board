// Ambil akun yang BENAR-BENAR ada di Cookie Chain, untuk dipakai sebagai fee payer saat
// simulasi. Tanpa ini, simulateTransaction selalu berhenti di AccountNotFound dan tidak
// membuktikan apa pun tentang instruksi Memo kita.
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

// Ambil blok terakhir yang sudah final, lalu kumpulkan fee payer dari transaksinya.
const epoch = await rpc('getEpochInfo')
const slot = epoch.absoluteSlot - 5

let payers = []
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
    // Slot kosong / dilewati itu normal di chain sepi.
  }
}

console.log('slot dicek sekitar:', slot)
console.log('fee payer ditemukan:', payers.length)
for (const p of payers) {
  try {
    const info = await rpc('getAccountInfo', [p, { encoding: 'base64' }])
    const v = info?.value
    console.log(`  ${p}  lamports=${v?.lamports ?? 0}  executable=${v?.executable ?? '-'}  owner=${(v?.owner ?? '-').slice(0, 20)}`)
  } catch (e) {
    console.log('  ' + p + '  GAGAL: ' + e.message)
  }
}
