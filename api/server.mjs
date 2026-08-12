import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleRequest } from './router.mjs'
import { attachExtensionWebSocketServer } from './relay/ws-server.mjs'
import { serveSpa } from './static/spa-route.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const runtimeDirectory = join(here, 'runtime')
const downloadsDirectory = join(here, 'downloads')
const distDirectory = join(here, '..', 'dist')
const host = process.env.PRIMAVERA_API_HOST ?? '127.0.0.1'
const port = Number(process.env.PRIMAVERA_API_PORT ?? 4100)
const allowedOrigin = process.env.PRIMAVERA_ALLOWED_ORIGIN ?? '*'

await mkdir(runtimeDirectory, { recursive: true })

function responseHeaders(origin) {
  const permittedOrigin = allowedOrigin === '*' || origin === allowedOrigin ? (origin ?? allowedOrigin) : allowedOrigin
  return {
    'Access-Control-Allow-Origin': permittedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
}

function send(res, status, body, origin) {
  res.writeHead(status, responseHeaders(origin))
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 5_000_000) throw new Error('Pedido demasiado grande.')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

export function createApiServer() {
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    if (req.method === 'OPTIONS') {
      res.writeHead(204, responseHeaders(origin))
      return res.end()
    }
    if (req.method === 'GET' && req.url === '/downloads/extension.zip') {
      const file = join(downloadsDirectory, 'extension.zip')
      try {
        const info = await stat(file)
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': info.size,
          'Content-Disposition': 'attachment; filename="extension.zip"',
          // O instalador é atualizado juntamente com novas regras SQL; nunca servir do cache uma
          // versão antiga quando o utilizador volta a descarregá-lo nas Configurações.
          'Cache-Control': 'no-store, max-age=0',
        })
        return createReadStream(file).pipe(res)
      } catch {
        res.writeHead(404)
        return res.end()
      }
    }
    if (req.method === 'GET' && req.url === '/downloads/defender-submission-3223096b.zip') {
      const file = join(downloadsDirectory, 'defender-submission-3223096b.zip')
      try {
        const info = await stat(file)
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': info.size,
          'Content-Disposition': 'attachment; filename="defender-submission-3223096b.zip"',
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        })
        return createReadStream(file).pipe(res)
      } catch {
        res.writeHead(404)
        return res.end()
      }
    }

    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      const urlPath = req.url.split('?')[0]
      return serveSpa(distDirectory, urlPath, res)
    }

    if (req.method !== 'POST') return send(res, 405, { success: false, message: 'Método não permitido.' }, origin)

    try {
      const body = await readBody(req)
      const result = await handleRequest(req.url, body, runtimeDirectory)
      return send(res, result.status, result.body, origin)
    } catch (error) {
      console.error(error)
      return send(res, 500, {
        success: false,
        message: error instanceof Error ? error.message : 'Erro interno da API.',
      }, origin)
    }
  })
  attachExtensionWebSocketServer(server, { runtimeDirectory })
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApiServer().listen(port, host, () => {
    console.log(`ERP Evolution API central em http://${host}:${port}/api/primavera`)
  })
}
