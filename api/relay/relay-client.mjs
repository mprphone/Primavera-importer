import { randomUUID } from 'node:crypto'
import { getConnection } from './extension-registry.mjs'

const REQUEST_TIMEOUT_MS = 40_000

export function relayRequest(token, rpc, payload) {
  const entry = getConnection(token)
  if (!entry) {
    const error = new Error('A extensão local não está ligada. Verifica se está em execução no PC com acesso ao SQL.')
    error.status = 503
    return Promise.reject(error)
  }

  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(requestId)
      const error = new Error('A extensão local não respondeu a tempo.')
      error.status = 504
      reject(error)
    }, REQUEST_TIMEOUT_MS)

    entry.pending.set(requestId, { resolve, reject, timer })
    entry.socket.send(JSON.stringify({ type: 'request', requestId, rpc, payload }))
  })
}

export function resolveResponse(token, message) {
  const entry = getConnection(token)
  if (!entry) return
  const pending = entry.pending.get(message.requestId)
  if (!pending) return
  clearTimeout(pending.timer)
  entry.pending.delete(message.requestId)
  if (message.success) {
    pending.resolve({ message: message.message, data: message.data })
  } else {
    const error = new Error(message.message || 'A extensão local devolveu um erro.')
    error.status = 502
    pending.reject(error)
  }
}
