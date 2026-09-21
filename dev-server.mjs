// Server statis minimal untuk menguji app di browser sungguhan.
// Dipakai hanya untuk verifikasi lokal — deployment produksi ke Cloudflare Pages.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = process.cwd()
const PORT = Number(process.argv[2] || 8080)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let path = decodeURIComponent(url.pathname)
  if (path === '/') path = '/index.html'

  // Cegah keluar dari ROOT.
  const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''))
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const body = await readFile(full)
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}).listen(PORT, () => console.log('serving ' + ROOT + ' on http://localhost:' + PORT))
