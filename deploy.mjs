// Deploys Cookie Board to Cloudflare Pages.
//
// Why this script exists: `wrangler pages deploy .` uploads the ENTIRE directory, and
// `.assetsignore` is not honoured on the Pages path — which exposes verify.mjs, README.md,
// package.json and the launch-thread draft at the public URL. Here only the three files the
// browser actually needs are copied into a staging directory, and that is what gets uploaded.
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
  throw new Error('staging does not match expectations — aborting deploy')
}

// Invoke wrangler as a Node script rather than through `npx` + shell: passing arguments through
// a shell on Windows mangles the argument list and wrangler just prints its help text.
const wrangler = join(globalRoot(), 'wrangler', 'bin', 'wrangler.js')

function globalRoot() {
  const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true })
  return (r.stdout || '').trim()
}

// Wrangler reads CLOUDFLARE_API_TOKEN from a .env file in the working directory, so run this
// script from wherever that file lives — not from inside this directory.
const r = spawnSync(
  process.execPath,
  [wrangler, 'pages', 'deploy', STAGE, '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'],
  { stdio: 'inherit' },
)

await rm(STAGE, { recursive: true, force: true })
process.exit(r.status ?? 1)
