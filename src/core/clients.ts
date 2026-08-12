import { PostingModel } from './models'
import { getServerStore, setServerStore } from './server-store'
import { stripAccents } from './utils'

const GLOBAL_STORE_COMPANY = '_global'
const CUSTOM_CLIENTS_STORE_KEY = 'custom_clients'

export type PrimaveraConnectionMode = 'txt' | 'direct'
export type VatRegime = 'normal' | 'isento'

export type ClientProfile = {
  id: string
  name: string
  legalName: string
  nif: string
  location: string
  primaveraCompanyCode: string
  connectionMode: PrimaveraConnectionMode
  vatRegime: VatRegime
  defaults: {
    diario: string
    documento: string
    startNumDiario: number
  }
  models: PostingModel[]
}

const receiptCreditTemplate = "SNNFP31121290                32       120201321  -1        COB PAG SERV -21287                                          2564.10C                                           1                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00"
const receiptDebitTemplate = "SNNFP31121201                32       120201321  -1        COB PAG SERV -21287                                          2564.10D                                           2                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00"

export const baseConfigurableModel: PostingModel = {
  id: 'base-two-lines',
  name: 'Modelo base (2 linhas)',
  description: 'Gera uma linha a débito e outra a crédito. Confirma as contas antes de exportar.',
  creditTemplate: receiptCreditTemplate,
  debitTemplate: receiptDebitTemplate,
  creditAccountFixed: '',
  debitAccountFixed: '',
  variables: [],
}

export const ClientProfiles: ClientProfile[] = [
  {
    id: 'vilarinho',
    name: 'Cooperativa Elétrica de Vilarinho',
    legalName: 'Cooperativa Electrica de Vilarinho Crl',
    nif: '501563245',
    location: 'Vilarinho, Santo Tirso',
    primaveraCompanyCode: 'CEV',
    connectionMode: 'txt',
    vatRegime: 'normal',
    defaults: {
      diario: '32',
      documento: '321',
      startNumDiario: 120001,
    },
    models: [
      {
        id: 'coop-receipts-1201-1290',
        name: 'Recibos Coop (1201 D / 1290 C)',
        description: 'Gera 2 linhas por movimento: 1201 a Débito e 1290 a Crédito.',
        creditTemplate: receiptCreditTemplate,
        debitTemplate: receiptDebitTemplate,
        creditAccountFixed: '1290',
        debitAccountFixed: '1201',
        variables: [],
      },
      {
        id: 'santander-payments-221110001-1201',
        name: 'Pagamentos Santander (221110001 D / 1201 C)',
        description: 'Gera 2 linhas por movimento: 221110001 a Débito (Fornecedor) e 1201 a Crédito.',
        creditTemplate: "SNNFP31121201                32       120129321  -1        DEVOLU\ufffd\ufffdO D\ufffdB.DIR-D3548559-631/01                             403.91C                                           1                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00",
        debitTemplate: "SNNFP3112221110001           32       120129321  -1        DEVOLU\ufffd\ufffdO D\ufffdB.DIR-D3548559-631/01                             403.91D                                           2                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00",
        creditAccountFixed: '1201',
        debitAccountFixed: '221110001',
        variables: [],
      },
    ],
  },
  {
    id: 'helbor',
    name: 'Helbor',
    legalName: 'Helbor - Imobiliária S.A',
    nif: '508737486',
    location: 'Póvoa de Varzim',
    primaveraCompanyCode: 'HELBOR',
    connectionMode: 'txt',
    vatRegime: 'isento',
    defaults: {
      diario: '',
      documento: '',
      startNumDiario: 1,
    },
    models: [baseConfigurableModel],
  },
]

const CUSTOM_CLIENTS_KEY = 'primavera_importer_custom_clients_v1'

export function loadCustomClients(): ClientProfile[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CLIENTS_KEY)
    return raw ? JSON.parse(raw) as ClientProfile[] : []
  } catch {
    return []
  }
}

function persistCustomClientsLocally(clients: ClientProfile[]) {
  try {
    localStorage.setItem(CUSTOM_CLIENTS_KEY, JSON.stringify(clients))
    return true
  } catch {
    return false
  }
}

function saveCustomClients(clients: ClientProfile[]) {
  const ok = persistCustomClientsLocally(clients)
  setServerStore(GLOBAL_STORE_COMPANY, CUSTOM_CLIENTS_STORE_KEY, clients)
  return ok
}

// Empresas "custom" podem ser criadas em qualquer PC, por isso o merge tem de
// ser por id (nunca uma substituição total), senão um dispositivo apaga do
// servidor as empresas que só existem noutro dispositivo.
function mergeClientsById(a: ClientProfile[], b: ClientProfile[]): ClientProfile[] {
  const byId = new Map<string, ClientProfile>()
  for (const client of a) byId.set(client.id, client)
  for (const client of b) byId.set(client.id, client)
  return [...byId.values()]
}

export async function refreshCustomClientsFromServer(): Promise<ClientProfile[] | null> {
  const local = loadCustomClients()
  const remote = await getServerStore<ClientProfile[]>(GLOBAL_STORE_COMPANY, CUSTOM_CLIENTS_STORE_KEY)
  if (!remote || !remote.length) return null

  // O servidor ganha em caso de conflito de id: reflete a versão mais
  // recentemente publicada, que pode ter sido editada noutro dispositivo.
  const merged = mergeClientsById(local, remote)
  const sortById = (list: ClientProfile[]) => [...list].sort((a, b) => a.id.localeCompare(b.id))
  const changed = JSON.stringify(sortById(merged)) !== JSON.stringify(sortById(local))

  if (!changed) return null

  persistCustomClientsLocally(merged)
  // Publica de volta para que o servidor fique com a união (self-heal caso
  // este dispositivo tivesse empresas que o servidor ainda não conhecia).
  setServerStore(GLOBAL_STORE_COMPANY, CUSTOM_CLIENTS_STORE_KEY, merged)
  return merged
}

export function getAllClientProfiles(): ClientProfile[] {
  return [...ClientProfiles, ...loadCustomClients()]
}

export function getClientProfile(clientId: string): ClientProfile | undefined {
  return getAllClientProfiles().find(client => client.id === clientId)
}

function slugify(value: string) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function nextClientId(name: string): string {
  const base = slugify(name) || 'empresa'
  const taken = new Set(getAllClientProfiles().map(client => client.id))
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export async function addCustomClient(profile: ClientProfile): Promise<void> {
  // Busca o estado mais recente do servidor antes de escrever, para não
  // perder empresas adicionadas entretanto noutro PC.
  const remote = await getServerStore<ClientProfile[]>(GLOBAL_STORE_COMPANY, CUSTOM_CLIENTS_STORE_KEY)
  const base = mergeClientsById(loadCustomClients(), remote ?? [])
  saveCustomClients([...base, profile])
}

export async function removeCustomClient(clientId: string): Promise<void> {
  const remote = await getServerStore<ClientProfile[]>(GLOBAL_STORE_COMPANY, CUSTOM_CLIENTS_STORE_KEY)
  const base = mergeClientsById(loadCustomClients(), remote ?? [])
  saveCustomClients(base.filter(client => client.id !== clientId))
}
