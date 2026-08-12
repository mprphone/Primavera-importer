import { InputRow } from './generator'
import { PostingModel } from './models'
import { PrimaveraMasterData } from './master-data'

export type PrimaveraExportRequest = {
  companyCode: string
  model: PostingModel
  rows: InputRow[]
  ano: number
  diario: string
  documento: string
  startNumDiario: number
  creditAccount: string
  debitAccount: string
}

export type PrimaveraExportResult = {
  success: boolean
  message: string
}

export type PrimaveraMasterDataResult = PrimaveraExportResult & {
  data?: PrimaveraMasterData
}

export type SqlConnectionSettings = {
  server: string
  database: string
  year?: number
  user?: string
  password?: string
}

export type EntityPageResult = PrimaveraExportResult & {
  data?: {
    items: import('./entities').Entity[]
    nextOffset: number
    hasMore: boolean
  }
}

export type LedgerMovement = {
  id: string
  account?: string
  journal?: string
  postingNumber?: string
  date: string
  description: string
  reference: string
  // Identificação do terceiro gravada no próprio movimento. É essencial quando uma compra é
  // lançada diretamente no banco/caixa e não passa por uma conta corrente 22/27.
  entityType?: string
  entityCode?: string
  debit: number
  credit: number
}

export type LedgerResult = PrimaveraExportResult & {
  data?: { movements: LedgerMovement[]; openingBalance: number }
}

export interface PrimaveraConnector {
  testConnection(companyCode: string, sql: SqlConnectionSettings, extensionToken: string): Promise<PrimaveraExportResult>
  saveFinancasCredentials(companyCode: string, user: string, password: string): Promise<PrimaveraExportResult>
  syncMasterData(companyCode: string, sql: SqlConnectionSettings, extensionToken: string): Promise<PrimaveraMasterDataResult>
  syncEntities(companyCode: string, sql: SqlConnectionSettings, entityType: 'customer' | 'supplier', offset: number, extensionToken: string): Promise<EntityPageResult>
  createPostings(request: PrimaveraExportRequest, extensionToken: string): Promise<PrimaveraExportResult>
  syncLedger(companyCode: string, sql: SqlConnectionSettings, account: string, dateFrom: string, dateTo: string, extensionToken: string): Promise<LedgerResult>
  syncPurchaseLedger(companyCode: string, sql: SqlConnectionSettings, dateFrom: string, dateTo: string, extensionToken: string): Promise<LedgerResult>
}

/**
 * Ponto de ligação para um futuro serviço local/servidor.
 * O browser não consegue usar diretamente o motor COM/ERP do ERP Evolution.
 */
export class PrimaveraGatewayConnector implements PrimaveraConnector {
  constructor(private readonly baseUrl: string) {}

  async testConnection(companyCode: string, sql: SqlConnectionSettings, extensionToken: string): Promise<PrimaveraExportResult> {
    return this.post('/health', { companyCode, sql, extensionToken })
  }

  async saveFinancasCredentials(companyCode: string, user: string, password: string): Promise<PrimaveraExportResult> {
    return this.post('/credentials/financas', { companyCode, user, password })
  }

  async syncMasterData(companyCode: string, sql: SqlConnectionSettings, extensionToken: string): Promise<PrimaveraMasterDataResult> {
    return this.post<PrimaveraMasterDataResult>('/master-data/sync', { companyCode, sql, extensionToken })
  }

  async syncEntities(
    companyCode: string,
    sql: SqlConnectionSettings,
    entityType: 'customer' | 'supplier',
    offset: number,
    extensionToken: string,
  ): Promise<EntityPageResult> {
    return this.post<EntityPageResult>('/master-data/entities', {
      companyCode,
      sql,
      entityType,
      offset,
      limit: 500,
      extensionToken,
    })
  }

  async createPostings(request: PrimaveraExportRequest, extensionToken: string): Promise<PrimaveraExportResult> {
    return this.post('/postings', { ...request, extensionToken })
  }

  async syncLedger(
    companyCode: string,
    sql: SqlConnectionSettings,
    account: string,
    dateFrom: string,
    dateTo: string,
    extensionToken: string,
  ): Promise<LedgerResult> {
    return this.post<LedgerResult>('/ledger/sync', { companyCode, sql, account, dateFrom, dateTo, extensionToken })
  }

  async syncPurchaseLedger(
    companyCode: string,
    sql: SqlConnectionSettings,
    dateFrom: string,
    dateTo: string,
    extensionToken: string,
  ): Promise<LedgerResult> {
    return this.post<LedgerResult>('/purchases/ledger', { companyCode, sql, dateFrom, dateTo, extensionToken })
  }

  private async post<T extends PrimaveraExportResult = PrimaveraExportResult>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      return {
        ...payload,
        success: response.ok,
        message: payload.message ?? (response.ok ? 'Operação concluída.' : 'O gateway ERP Evolution devolveu um erro.'),
      } as T
    } catch (error) {
      return {
        success: false,
        message: error instanceof DOMException && error.name === 'AbortError'
          ? 'A sincronização ultrapassou 45 segundos. Verifica o gateway ou tenta novamente.'
          : 'Não foi possível contactar o gateway local do ERP Evolution.',
      } as T
    } finally {
      window.clearTimeout(timeout)
    }
  }
}
