// Uji jalur yang paling berisiko dan belum pernah diverifikasi: konstruksi transaksi stamp.
//
// app.js membangun transaksi Memo, menyerialisasinya, lalu menyerahkan byte-nya ke wallet.
// Kalau konstruksinya salah, wallet akan menolak atau transaksinya gagal di chain — dan itu
// tidak akan terlihat sampai ada orang dengan COOK mencobanya.
//
// Di sini kita tiru persis logika app.js, lalu minta Cookie Chain MENYIMULASIKAN transaksinya.
// Simulasi membuktikan instruksinya valid menurut runtime chain yang sebenarnya, tanpa
// memerlukan COOK sama sekali.
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'

const RPC_HTTP = 'https://rpc.cookiescan.io'
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

// Nilai yang dipakai app.js; harus sama persis.
const MEMO_TEXT = 'gm from Cookie Board'

// Fee payer harus akun yang SUDAH ADA di Cookie Chain. Akun karangan membuat
// simulateTransaction berhenti di AccountNotFound sebelum sempat menjalankan instruksi Memo,
// sehingga tidak membuktikan apa pun. Alamat ini ditemukan lewat find-payer.mjs dari blok nyata
// dan hanya dipakai sebagai fee payer dengan sigVerify=false — kita tidak menandatangani apa pun.
const APP_SIGNER = new PublicKey('DL9GPSXrhAEnU5Ads3HLhEJ9fCDLpnmmkzxoe712W4xP')

const connection = new Connection(RPC_HTTP, 'confirmed')

console.log('RPC:', RPC_HTTP)
console.log('genesis:', await connection.getGenesisHash())
console.log('versi  :', (await connection.getVersion())['solana-core'])

// --- 1. Program Memo benar-benar ada di chain ini?
const memoAcct = await connection.getAccountInfo(new PublicKey(MEMO_PROGRAM_ID))
console.log('\nprogram Memo:', MEMO_PROGRAM_ID)
console.log('  ada      :', memoAcct !== null)
console.log('  executable:', memoAcct?.executable)
console.log('  owner    :', memoAcct?.owner.toBase58())

// --- 2. Bangun transaksi dengan cara yang SAMA seperti app.js
const memoIx = new TransactionInstruction({
  keys: [{ pubkey: APP_SIGNER, isSigner: true, isWritable: true }],
  programId: new PublicKey(MEMO_PROGRAM_ID),
  data: new TextEncoder().encode(MEMO_TEXT),
})

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
const tx = new Transaction().add(memoIx)
tx.feePayer = APP_SIGNER
tx.recentBlockhash = blockhash

const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
console.log('\ntransaksi dibangun:')
console.log('  ukuran terserialisasi:', serialized.length, 'byte')
console.log('  blockhash            :', blockhash)
console.log('  lastValidBlockHeight :', lastValidBlockHeight)
console.log('  feePayer             :', tx.feePayer.toBase58())
console.log('  instruksi            :', tx.instructions.length)

// --- 3. Minta chain menyimulasikan. sigVerify=false karena kita belum menandatangani.
const sim = await connection.simulateTransaction(tx, undefined, false)
console.log('\nhasil simulasi:')
console.log('  err      :', JSON.stringify(sim.value.err))
console.log('  units    :', sim.value.unitsConsumed)
console.log('  log      :')
for (const line of sim.value.logs || []) console.log('    ' + line)

// --- 4. Kalau Memo-nya benar, teksnya harus muncul di log Program log:
const sawMemo = (sim.value.logs || []).some((l) => l.includes(MEMO_TEXT))
console.log('\nteks memo muncul di log:', sawMemo)

// --- 5. Cek biaya signature supaya README tidak menebak
const fee = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed')
console.log('biaya yang dilaporkan chain:', fee.value, 'lamports')
if (fee.value !== null) {
  const cook = fee.value / 1e9
  const { default: https } = await import('node:https')
  const price = await new Promise((resolve) => {
    https
      .get('https://api.cookiescan.io/api/status', (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => {
          try { resolve(JSON.parse(d).cookUsd) } catch { resolve(null) }
        })
      })
      .on('error', () => resolve(null))
  })
  console.log(`  = ${cook} COOK` + (price ? ` ≈ $${(cook * price).toExponential(2)}` : ''))
}

console.log('\n--- KESIMPULAN ---')
const ok = memoAcct?.executable && sim.value.err === null && sawMemo
console.log(ok ? 'LULUS: transaksi valid dan diterima runtime Cookie Chain.' : 'GAGAL: ada yang salah.')
process.exit(ok ? 0 : 1)
