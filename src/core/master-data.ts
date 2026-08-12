import { Entity } from './entities'
import { getServerStore, setServerStore } from './server-store'

export type Account = {
  code: string
  description: string
  active?: boolean
  vatClass?: string
}

export type VatRate = {
  code: string
  description: string
  rate: number
  account?: string
}

export type CodeDescription = {
  code: string
  description: string
}

export type AccountingYear = {
  year: number
  description: string
}

export type PrimaveraMasterData = {
  accounts: Account[]
  customers: Entity[]
  suppliers: Entity[]
  vatRates: VatRate[]
  journals: CodeDescription[]
  documents: CodeDescription[]
  accountingYears: AccountingYear[]
  currencies: CodeDescription[]
  series: CodeDescription[]
  warnings: string[]
  syncedAt: string
}

function storageKey(clientId: string) {
  return `primavera_importer_master_data_v1_${clientId}`
}

export function emptyMasterData(): PrimaveraMasterData {
  return {
    accounts: [],
    customers: [],
    suppliers: [],
    vatRates: [],
    journals: [],
    documents: [],
    accountingYears: [],
    currencies: [],
    series: [],
    warnings: [],
    syncedAt: '',
  }
}

export function loadMasterData(clientId: string): PrimaveraMasterData {
  try {
    const raw = localStorage.getItem(storageKey(clientId))
    return raw ? { ...emptyMasterData(), ...JSON.parse(raw) } : emptyMasterData()
  } catch {
    return emptyMasterData()
  }
}

export function saveMasterData(clientId: string, data: PrimaveraMasterData) {
  try {
    localStorage.setItem(storageKey(clientId), JSON.stringify(data))
    setServerStore(clientId, 'master_data', data)
    return true
  } catch {
    return false
  }
}

export async function refreshMasterDataFromServer(clientId: string): Promise<PrimaveraMasterData | null> {
  if (loadMasterData(clientId).syncedAt) return null
  const remote = await getServerStore<PrimaveraMasterData>(clientId, 'master_data')
  if (!remote || !remote.syncedAt) return null
  const merged = { ...emptyMasterData(), ...remote }
  saveMasterData(clientId, merged)
  return merged
}
