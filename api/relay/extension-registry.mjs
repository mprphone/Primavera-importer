const connections = new Map()

export function getConnection(companyCode) {
  return connections.get(companyCode)
}

export function isConnected(companyCode) {
  return connections.has(companyCode)
}

export function register(companyCode, socket) {
  const existing = connections.get(companyCode)
  if (existing && existing.socket !== socket) {
    return null
  }
  const entry = { socket, pending: new Map(), lastSeenAt: Date.now() }
  connections.set(companyCode, entry)
  return entry
}

export function touch(companyCode) {
  const entry = connections.get(companyCode)
  if (entry) entry.lastSeenAt = Date.now()
}

export function unregister(companyCode, socket) {
  const entry = connections.get(companyCode)
  if (!entry || entry.socket !== socket) return
  for (const { reject, timer } of entry.pending.values()) {
    clearTimeout(timer)
    reject(new Error('A ligação à extensão local foi perdida durante o pedido.'))
  }
  connections.delete(companyCode)
}
