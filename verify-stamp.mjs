// Tests the riskiest and least-verified path: construction of the stamp transaction.
//
// app.js builds a Memo transaction, serializes it, and hands the bytes to the wallet. If the
// construction is wrong, the wallet will refuse it or the transaction will fail on chain — and
// nobody would notice until someone holding COOK tried it.
//
// So this reproduces app.js's logic exactly, then asks Cookie Chain to SIMULATE the transaction.
// A simulation proves the instruction is valid according to the chain's real runtime, and it
// needs no COOK at all.
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'

const RPC_HTTP = 'https://rpc.cookiescan.io'
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

// The values app.js uses; these have to match exactly.
const MEMO_TEXT = 'gm from Cookie Board'

// The fee payer must be an account that ALREADY EXISTS on Cookie Chain. An invented address
// makes simulateTransaction abort at AccountNotFound before the Memo instruction ever runs, so
// it would prove nothing. This address was found by find-payer.mjs from a real block and is used
// only as a fee payer with sigVerify=false — nothing is signed here.
const APP_SIGNER = new PublicKey('DL9GPSXrhAEnU5Ads3HLhEJ9fCDLpnmmkzxoe712W4xP')

const connection = new Connection(RPC_HTTP, 'confirmed')

console.log('RPC:', RPC_HTTP)
console.log('genesis:', await connection.getGenesisHash())
console.log('version:', (await connection.getVersion())['solana-core'])

// --- 1. Does the Memo program actually exist on this chain?
const memoAcct = await connection.getAccountInfo(new PublicKey(MEMO_PROGRAM_ID))
console.log('\nMemo program:', MEMO_PROGRAM_ID)
console.log('  present   :', memoAcct !== null)
console.log('  executable:', memoAcct?.executable)
console.log('  owner     :', memoAcct?.owner.toBase58())

// --- 2. Build the transaction the SAME way app.js does
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
console.log('\ntransaction built:')
console.log('  serialized size      :', serialized.length, 'bytes')
console.log('  blockhash            :', blockhash)
console.log('  lastValidBlockHeight :', lastValidBlockHeight)
console.log('  feePayer             :', tx.feePayer.toBase58())
console.log('  instructions         :', tx.instructions.length)

// --- 3. Ask the chain to simulate. sigVerify=false because nothing is signed yet.
const sim = await connection.simulateTransaction(tx, undefined, false)
console.log('\nsimulation result:')
console.log('  err   :', JSON.stringify(sim.value.err))
console.log('  units :', sim.value.unitsConsumed)
console.log('  log   :')
for (const line of sim.value.logs || []) console.log('    ' + line)

// --- 4. If the Memo is correct, its text must appear in the program log
const sawMemo = (sim.value.logs || []).some((l) => l.includes(MEMO_TEXT))
console.log('\nmemo text present in log:', sawMemo)

// --- 5. Ask the chain for the real fee so the README does not have to guess
const fee = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed')
console.log('fee reported by the chain:', fee.value, 'lamports')
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

console.log('\n--- CONCLUSION ---')
const ok = memoAcct?.executable && sim.value.err === null && sawMemo
console.log(ok ? 'PASS: transaction is valid and accepted by the Cookie Chain runtime.' : 'FAIL: something is wrong.')
process.exit(ok ? 0 : 1)
