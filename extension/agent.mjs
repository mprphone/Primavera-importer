import WebSocket from 'ws'
import { handleCommand } from './command-handlers.mjs'
import { FilePrimaveraProvider } from './providers/file-provider.mjs'
import { PrimaveraSdkProvider } from './providers/primavera-sdk-provider.mjs'
import { SqlPrimaveraProvider } from './providers/sql-provider.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const apiUrl = process.env.PRIMAVERA_API_URL ?? 'wss://pri.mpr.pt/api/extension/ws'
const token = process.env.PRIMAVERA_EXTENSION_TOKEN
const providerName = process.env.PRIMAVERA_PROVIDER ?? 'sql'

if (!token) throw new Error('Define PRIMAVERA_EXTENSION_TOKEN.')

const provider = providerName === 'sdk'
  ? new PrimaveraSdkProvider()
  : providerName === 'file'
    ? new FilePrimaveraProvider({ seedDirectory: join(here, 'seed'), runtimeDirectory: join(here, 'runtime') })
    : new SqlPrimaveraProvider()

const PING_INTERVAL_MS = 25_000
// Uma rede (router/firewall do cliente) por vezes deita fora a ligação sem enviar FIN/RST — o
// socket fica "zombie": parece aberto dos dois lados, mas nada chega ao servidor. Sem isto, a
// extensão nunca dá erro/close e por isso nunca tenta religar sozinha, mesmo que o servidor já
// tenha desregistado esta ligação há muito (ver IDLE_TIMEOUT_MS em api/relay/ws-server.mjs).
// Tolera um pong perdido antes de forçar reconexão.
const PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2.5
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000]

let reconnectAttempt = 0

function connect() {
  console.log(`A ligar a ${apiUrl}...`)
  const socket = new WebSocket(apiUrl)
  let pingTimer = null
  let watchdogTimer = null
  let lastPongAt = Date.now()
  let reconnect = true

  socket.on('open', () => {
    socket.send(JSON.stringify({ type: 'register', token, agentVersion: '1.7.2' }))
  })

  socket.on('message', async raw => {
    let message
    try {
      message = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }

    if (message.type === 'registered') {
      console.log('Registado. Pronto para receber pedidos de qualquer empresa deste SQL Server.')
      reconnectAttempt = 0
      lastPongAt = Date.now()
      pingTimer = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), PING_INTERVAL_MS)
      watchdogTimer = setInterval(() => {
        if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
          console.error(`Sem resposta do servidor há mais de ${Math.round(PONG_TIMEOUT_MS / 1000)}s — ligação morta. A forçar reconexão...`)
          socket.terminate()
        }
      }, PING_INTERVAL_MS)
      return
    }

    if (message.type === 'register-error') {
      console.error(`Falha no registo: ${message.message}`)
      reconnect = false
      socket.close()
      return
    }

    if (message.type === 'pong') {
      lastPongAt = Date.now()
      return
    }

    if (message.type === 'request') {
      try {
        const result = await handleCommand(provider, message.rpc, message.payload)
        socket.send(JSON.stringify({ type: 'response', requestId: message.requestId, ...result }))
      } catch (error) {
        socket.send(JSON.stringify({
          type: 'response',
          requestId: message.requestId,
          success: false,
          message: error instanceof Error ? error.message : 'Erro desconhecido na extensão local.',
        }))
      }
    }
  })

  socket.on('close', (code, rawReason) => {
    clearInterval(pingTimer)
    clearInterval(watchdogTimer)
    const reason = rawReason.toString('utf8')
    if (!reconnect || code === 4001 || code === 4003) {
      console.error(reason || 'A extensão foi desligada pelo servidor.')
      console.error('Esta janela não vai voltar a ligar automaticamente.')
      return
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    reconnectAttempt += 1
    console.log(`Ligação fechada${reason ? ` (${reason})` : ''}. A tentar novamente em ${delay / 1000}s...`)
    setTimeout(connect, delay)
  })

  socket.on('error', error => {
    console.error(`Erro de ligação: ${error.message}`)
  })
}

connect()
