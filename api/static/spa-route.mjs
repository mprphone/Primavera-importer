import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function sendFile(filePath, res) {
  const info = await stat(filePath)
  if (info.isDirectory()) throw Object.assign(new Error('is a directory'), { code: 'EISDIR' })
  const type = MIME_TYPES[extname(filePath)] || 'application/octet-stream'
  const isPwaControlFile = filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')
  const headers = {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': filePath.endsWith('index.html') || isPwaControlFile ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  }
  if (filePath.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/'
  res.writeHead(200, headers)
  createReadStream(filePath).pipe(res)
}

export async function serveSpa(distDirectory, urlPath, res) {
  const safePath = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  const filePath = join(distDirectory, safePath === '/' ? 'index.html' : safePath)
  if (!filePath.startsWith(distDirectory)) {
    return sendFile(join(distDirectory, 'index.html'), res)
  }
  try {
    await sendFile(filePath, res)
  } catch {
    await sendFile(join(distDirectory, 'index.html'), res)
  }
}
