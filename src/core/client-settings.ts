import { CENTRAL_API_BASE_URL } from './api-config'
import { ClientProfile, PrimaveraConnectionMode, VatRegime } from './clients'
import { getServerStore, setServerStore } from './server-store'

export type ClientSettings = {
  primaveraCompanyCode: string
  connectionMode: PrimaveraConnectionMode
  vatRegime: VatRegime
  gatewayUrl: string
  extensionToken: string
  sqlServer: string
  sqlDatabase: string
  sqlUser: string
  sqlPassword: string
  financasUser: string
  selectedModelId: string
  diario: string
  documento: string
  startNumDiario: number
  postingsJournal: string
  postingsDocument: string
  models: Record<string, {
    creditAccount: string
    debitAccount: string
  }>
}

function storageKey(clientId: string) {
  return `primavera_importer_client_settings_v2_${clientId}`
}

export function defaultClientSettings(client: ClientProfile): ClientSettings {
  return {
    primaveraCompanyCode: client.primaveraCompanyCode,
    connectionMode: client.connectionMode,
    vatRegime: client.vatRegime,
    gatewayUrl: CENTRAL_API_BASE_URL,
    extensionToken: '',
    sqlServer: 'SRVSQL',
    sqlDatabase: client.id === 'helbor' ? 'PRIHELBOR' : '',
    sqlUser: '',
    sqlPassword: '',
    financasUser: client.nif,
    selectedModelId: client.models[0].id,
    diario: client.defaults.diario,
    documento: client.defaults.documento,
    startNumDiario: client.defaults.startNumDiario,
    postingsJournal: client.defaults.diario,
    postingsDocument: client.defaults.documento,
    models: Object.fromEntries(client.models.map(model => [
      model.id,
      {
        creditAccount: model.creditAccountFixed ?? '',
        debitAccount: model.debitAccountFixed ?? '',
      },
    ])),
  }
}

export function loadClientSettings(client: ClientProfile): ClientSettings {
  const defaults = defaultClientSettings(client)
  try {
    const raw = localStorage.getItem(storageKey(client.id))
      ?? localStorage.getItem(`primavera_importer_client_settings_v1_${client.id}`)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<ClientSettings>
    return {
      ...defaults,
      ...saved,
      models: {
        ...defaults.models,
        ...(saved.models ?? {}),
      },
    }
  } catch {
    return defaults
  }
}

export function saveClientSettings(clientId: string, settings: ClientSettings) {
  localStorage.setItem(storageKey(clientId), JSON.stringify(settings))
  setServerStore(clientId, 'client_settings', settings)
}

export async function refreshClientSettingsFromServer(client: ClientProfile): Promise<ClientSettings | null> {
  const hasLocal = localStorage.getItem(storageKey(client.id))
    ?? localStorage.getItem(`primavera_importer_client_settings_v1_${client.id}`)
  if (hasLocal) return null
  const remote = await getServerStore<ClientSettings>(client.id, 'client_settings')
  if (!remote) return null
  saveClientSettings(client.id, remote)
  return remote
}
