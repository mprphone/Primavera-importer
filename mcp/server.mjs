import 'dotenv/config'
import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireAuth } from './lib/auth-middleware.mjs'
import { oauthRouter } from './lib/oauth-routes.mjs'
import { createMcpServer } from './mcpServer.mjs'

for (const name of ['MCP_SERVER_URL', 'MCP_OWNER_EMAIL', 'MCP_OWNER_PASSWORD']) {
  if (!process.env[name]) {
    console.warn(`[mcp] Aviso: ${name} não está definido no .env — o servidor vai arrancar mas o login/autenticação vai falhar.`)
  }
}

const app = express()
app.disable('x-powered-by')

app.use(oauthRouter())

app.post('/mcp', express.json(), requireAuth, async (req, res) => {
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // modo stateless: uma sessão por pedido
  })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error('[mcp] Erro a processar pedido:', error)
    if (!res.headersSent) res.status(500).json({ error: 'server_error', error_description: error.message })
  }
})

const host = process.env.MCP_HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4200)
app.listen(port, host, () => {
  console.log(`Servidor MCP a correr em http://${host}:${port} (público em ${process.env.MCP_SERVER_URL ?? '?'})`)
})
