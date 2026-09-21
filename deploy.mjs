// Deploy Cookie Board ke Cloudflare Pages.
//
// Kenapa ada skrip ini: `wrangler pages deploy .` mengunggah SELURUH direktori, dan
// `.assetsignore` tidak diterapkan pada jalur Pages — akibatnya verify.mjs, README.md,
// package.json, dan draft X thread ikut terekspos di URL publik. Di sini hanya tiga berkas
// yang benar-benar dipakai browser yang disalin ke direktori staging, lalu itu yang diunggah.
import { mkdir, rm, copyFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const STAGE = join(ROOT, 'deploy-stage')
const ASSETS = ['index.html', 'app.js', 'styles.css']
const PROJECT = process.argv[2] || 'cookie-board'

await rm(STAGE, { recursive: true, force: true })
await mkdir(STAGE, { recursive: true })
for (const f of ASSETS) await copyFile(join(ROOT, f), join(STAGE, f))

const staged = await readdir(STAGE)
console.log('staging:', staged.join(', '))
if (staged.length !== ASSETS.length) {
  throw new Error('staging tidak sesuai harapan — batal deploy')
}

// Panggil wrangler sebagai skrip Node, bukan lewat `npx` + shell: meneruskan argumen
// melalui shell di Windows merusak daftar argumen dan wrangler malah mencetak bantuan.
const wrangler = join(globalRoot(), 'wrangler', 'bin', 'wrangler.js')

function globalRoot() {
  const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true })
  return (r.stdout || '').trim()
}

const r = spawnSync(
  process.execPath,
  [wrangler, 'pages', 'deploy', STAGE, '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'],
  { stdio: 'inherit' },
)

await rm(STAGE, { recursive: true, force: true })
process.exit(r.status ?? 1)
