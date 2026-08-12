import { WebSocketServer } from 'ws'
import { isValidToken } from '../tokens/extension-tokens.mjs'
import { register, touch, unregister } from './extension-registry.mjs'
import { resolveResponse } from './relay-client.mjs'

const REGISTER_TIMEOUT_MS = 5_000
const IDLE_TIMEOUT_MS = 60_000

// Sem isto não há nenhum rasto no servidor de ligações/desligações da extensão — diagnosticar
// "não está ligada" era sempre adivinhar às cegas. Só os últimos 4 carateres do token (nunca o
// token completo) para poder identificar a ligação sem o expor nos logs.
function shortToken(token) {
  return token ? `…${token.slice(-4)}` : '(sem token)'
}

export function attachExtensionWebSocketServer(server, { runtimeDirectory }) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/api/extension/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
  })

  wss.on('connection', (socket, request) => {
    let token = null
    let idleTimer = null
    const remote = request.socket.remoteAddress
    console.log(`[extension-ws] nova ligação de ${remote}`)

    const resetIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        // Uma ligação zombie (rede que morreu sem FIN/RST) pode nunca completar o handshake de
        // close() — terminate() derruba a ligação de imediato, sem depender de resposta do outro
        // lado. Desregista aqui mesmo, sem esperar pelo evento 'close', para nunca deixar uma
        // entrada fantasma a bloquear novas ligações com o mesmo token — visto em produção: uma
        // extensão reinstalada era rejeitada como "ligação duplicada" porque a ligação antiga,
        // já morta, nunca tinha sido removida do registo.
        console.log(`[extension-ws] timeout de inatividade, a derrubar ${shortToken(token)}`)
        if (token) unregister(token, socket)
        socket.terminate()
      }, IDLE_TIMEOUT_MS)
    }

    const registerTimer = setTimeout(() => {
      if (!token) {
        console.log(`[extension-ws] registo não recebido a tempo de ${remote}`)
        socket.close(4002, 'Registo não recebido a tempo.')
      }
    }, REGISTER_TIMEOUT_MS)

    socket.on('message', async raw => {
      let message
      try {
        message = JSON.parse(raw.toString('utf8'))
      } catch {
        return
      }

      if (message.type === 'register') {
        clearTimeout(registerTimer)
        const valid = await isValidToken(runtimeDirectory, message.token)
        if (!valid) {
          console.log(`[extension-ws] token inválido de ${remote}: ${shortToken(message.token)}`)
          socket.send(JSON.stringify({ type: 'register-error', message: 'Token inválido.' }))
          socket.close(4003, 'Token inválido.')
          return
        }
        token = message.token
        const entry = register(token, socket)
        if (!entry) {
          console.log(`[extension-ws] registo duplicado rejeitado para ${shortToken(token)} (${remote}) — já existe uma ligação ativa com este token`)
          token = null
          socket.send(JSON.stringify({
            type: 'register-error',
            message: 'Já existe uma extensão ativa com este token. Fecha as janelas duplicadas e mantém apenas uma.',
          }))
          socket.close(4001, 'Ligação duplicada.')
          return
        }
        console.log(`[extension-ws] registado ${shortToken(token)} (${remote}, versão ${message.agentVersion ?? 'desconhecida'})`)
        resetIdleTimer()
        socket.send(JSON.stringify({ type: 'registered' }))
        return
      }

      if (!token) return

      if (message.type === 'ping') {
        resetIdleTimer()
        touch(token)
        socket.send(JSON.stringify({ type: 'pong' }))
        return
      }

      if (message.type === 'response') {
        resetIdleTimer()
        resolveResponse(token, message)
      }
    })

    socket.on('close', (code, rawReason) => {
      console.log(`[extension-ws] ligação fechada ${shortToken(token)} (${remote}) código ${code} ${rawReason?.toString('utf8') ?? ''}`)
      clearTimeout(registerTimer)
      clearTimeout(idleTimer)
      if (token) unregister(token, socket)
    })
  })

  return wss
}
