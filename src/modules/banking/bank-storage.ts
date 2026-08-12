import { getServerStore, setServerStore } from '../../core/server-store'
import { BankMovement, ImportBatch, ReconciliationMatch } from './types'

type BankingState = {
  movements: BankMovement[]
  matches: ReconciliationMatch[]
  bankOpeningBalances?: Record<string, number>
  accountingOpeningBalances?: Record<string, number>
  bankClosingBalanceChecks?: Record<string, number>
  importBatches?: ImportBatch[]
}

function key(clientId: string) {
  return `primavera_importer_banking_v1_${clientId}`
}

export function openingBalanceKey(account: string, month: string) {
  return `${account}|${month}`
}

const emptyState = (): BankingState => ({
  movements: [], matches: [], bankOpeningBalances: {}, accountingOpeningBalances: {},
  bankClosingBalanceChecks: {}, importBatches: [],
})

export function loadBankingState(clientId: string): BankingState {
  try {
    const raw = localStorage.getItem(key(clientId))
    return raw ? { ...emptyState(), ...JSON.parse(raw) as BankingState } : emptyState()
  } catch {
    return emptyState()
  }
}

export function saveBankingState(clientId: string, state: BankingState) {
  try {
    localStorage.setItem(key(clientId), JSON.stringify(state))
    setServerStore(clientId, 'banking', state)
    return true
  } catch {
    return false
  }
}

export async function refreshBankingStateFromServer(clientId: string): Promise<BankingState | null> {
  const local = loadBankingState(clientId)
  const remote = await getServerStore<BankingState>(clientId, 'banking')
  if (!remote || (!remote.movements?.length && !remote.matches?.length)) return null
  if (!local.movements.length && !local.matches.length) {
    localStorage.setItem(key(clientId), JSON.stringify(remote))
    return remote
  }

  // O servidor pode ter recebido contexto novo do SAF-T depois de os movimentos já existirem no
  // navegador. Traz apenas esse enriquecimento, preservando seleções, reconciliações e saldos locais.
  const remoteById = new Map(remote.movements.map(item => [item.id, item]))
  let changed = false
  const movements = local.movements.map(item => {
    const serverItem = remoteById.get(item.id)
    if (!serverItem?.saft) return item
    const gainsContext = !item.saft
      || (!item.saft.counterpartyName && Boolean(serverItem.saft.counterpartyName))
      || (!item.saft.counterpartyTaxId && Boolean(serverItem.saft.counterpartyTaxId))
    if (!gainsContext) return item
    changed = true
    return { ...item, nif: item.nif || serverItem.nif, saft: { ...item.saft, ...serverItem.saft } }
  })
  if (!changed) return null
  const merged = { ...local, movements }
  localStorage.setItem(key(clientId), JSON.stringify(merged))
  return merged
}

export function mergeMovements(current: BankMovement[], imported: BankMovement[]) {
  const byId = new Map(current.map(item => [item.id, item]))
  imported.forEach(item => {
    if (!byId.has(item.id)) byId.set(item.id, item)
  })
  return Array.from(byId.values())
}

// O id de um movimento já é um hash determinístico de conta/data/valor/descrição (ver
// bank-parser.ts) — duas importações do mesmo extrato (ou de extratos com datas a sobrepor-se)
// geram os mesmos ids, por isso basta verificar quais já existem para saber o que é repetido.
export function countDuplicates(current: BankMovement[], imported: BankMovement[]) {
  const existingIds = new Set(current.map(item => item.id))
  return imported.filter(item => existingIds.has(item.id)).length
}

// Anula uma importação removendo os seus movimentos — mas nunca os que já foram reconciliados,
// para não desfazer silenciosamente um trabalho de conferência já confirmado pelo contabilista.
export function removeImportBatch(movements: BankMovement[], batchId: string) {
  const fromBatch = movements.filter(item => item.importBatchId === batchId)
  const removed = fromBatch.filter(item => item.status === 'pending')
  const kept = fromBatch.filter(item => item.status !== 'pending')
  const removedIds = new Set(removed.map(item => item.id))
  return {
    movements: movements.filter(item => !removedIds.has(item.id)),
    removedCount: removed.length,
    keptReconciledCount: kept.length,
  }
}
