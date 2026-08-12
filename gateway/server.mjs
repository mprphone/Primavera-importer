import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeEncryptedJson } from './lib/crypto-store.mjs'
import { FilePrimaveraProvider } from './providers/file-provider.mjs'
import { PrimaveraSdkProvider } from './providers/primavera-sdk-provider.mjs'
import { SqlPrimaveraProvider } from './providers/sql-provider.mjs'
import { fetchEfaturaInvoices } from './services/efatura-service.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const runtimeDirectory = join(here, 'runtime')
const seedDirectory = join(here, 'seed')
const host = process.env.PRIMAVERA_GATEWAY_HOST ?? '127.0.0.1'
const port = Number(process.env.PRIMAVERA_GATEWAY_PORT ?? 43120)
const allowedOrigin = process.env.PRIMAVERA_ALLOWED_ORIGIN ?? 'http://localhost:5173'
const providerName = process.env.PRIMAVERA_PROVIDER ?? 'file'
const provider = providerName === 'sdk'
  ? new PrimaveraSdkProvider()
  : providerName === 'sql'
    ? new SqlPrimaveraProvider()
    : new FilePrimaveraProvider({ seedDirectory, runtimeDirectory })

await mkdir(runtimeDirectory, { recursive: true })

function responseHeaders(origin) {
  const permittedOrigin = origin === allowedOrigin ? origin : allowedOrigin
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

function validCompanyCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value)
}

export function createGatewayServer() {
  return createServer(async (req, res) => {
    const origin = req.headers.origin
    if (req.method === 'OPTIONS') {
      res.writeHead(204, responseHeaders(origin))
      return res.end()
    }
    if (req.method !== 'POST') return send(res, 405, { success: false, message: 'Método não permitido.' }, origin)

    try {
      const body = await readBody(req)
      if (!validCompanyCode(body.companyCode)) {
        return send(res, 400, { success: false, message: 'Código da empresa inválido.' }, origin)
      }

      if (req.url === '/api/primavera/health') {
        const result = await provider.health(body.companyCode, body)
        return send(res, result.success ? 200 : 503, result, origin)
      }

      if (req.url === '/api/primavera/credentials/financas') {
        if (typeof body.user !== 'string' || !body.user.trim() || typeof body.password !== 'string' || !body.password) {
          return send(res, 400, { success: false, message: 'Utilizador e palavra-passe são obrigatórios.' }, origin)
        }
        await writeEncryptedJson(
          join(runtimeDirectory, 'credentials', `${body.companyCode}.json.enc`),
          { user: body.user.trim(), password: body.password, updatedAt: new Date().toISOString() },
          process.env.PRIMAVERA_GATEWAY_KEY,
        )
        return send(res, 200, { success: true, message: 'Credenciais cifradas e guardadas no gateway local.' }, origin)
      }

      if (req.url === '/api/primavera/master-data/sync') {
        const data = await provider.syncMasterData(body.companyCode, body)
        return send(res, 200, { success: true, message: 'Dados do ERP Evolution sincronizados.', data }, origin)
      }

      if (req.url === '/api/primavera/master-data/entities') {
        if (!['customer', 'supplier'].includes(body.entityType)) {
          return send(res, 400, { success: false, message: 'Tipo de entidade inválido.' }, origin)
        }
        const data = await provider.syncEntities(body.companyCode, body)
        return send(res, 200, { success: true, message: 'Página de entidades sincronizada.', data }, origin)
      }

      if (req.url === '/api/primavera/ledger/sync') {
        const data = await provider.syncLedger(body.companyCode, body)
        return send(res, 200, {
          success: true,
          message: `${data.movements?.length ?? 0} movimentos lidos.`,
          data,
        }, origin)
      }

      if (req.url === '/api/primavera/efatura/fetch') {
        if (
          typeof body.dateFrom !== 'string' ||
          typeof body.dateTo !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.dateTo) ||
          body.dateFrom > body.dateTo
        ) {
          return send(res, 400, { success: false, message: 'Período e-Fatura inválido.' }, origin)
        }
        const data = await fetchEfaturaInvoices({
          runtimeDirectory,
          companyCode: body.companyCode,
          dateFrom: body.dateFrom,
          dateTo: body.dateTo,
        })
        return send(res, 200, {
          success: true,
          message: `${data.invoices?.length ?? 0} faturas recolhidas do e-Fatura.`,
          data,
        }, origin)
      }

      if (req.url === '/api/primavera/postings') {
        const result = await provider.createPostings(body.companyCode, body)
        return send(res, result.success ? 200 : 502, result, origin)
      }

      return send(res, 404, { success: false, message: 'Endpoint não encontrado.' }, origin)
    } catch (error) {
      console.error(error)
      return send(res, 500, {
        success: false,
        message: error instanceof Error ? error.message : 'Erro interno do gateway.',
      }, origin)
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createGatewayServer().listen(port, host, () => {
    console.log(`ERP Evolution Gateway em http://${host}:${port}/api/primavera`)
    console.log(`Fornecedor ativo: ${providerName}`)
  })
}
