export type MovementSource = 'bank' | 'accounting'
export type MovementNature = 'D' | 'C'
export type MovementStatus = 'pending' | 'reconciled'

export type BankMovement = {
  id: string
  source: MovementSource
  account: string
  date: string
  description: string
  reference: string
  nif?: string
  iban?: string
  amount: number
  nature: MovementNature
  status: MovementStatus
  matchId?: string
  importedAt: string
  importBatchId?: string
  saft?: {
    transactionId: string
    journal: string
    postingNumber: string
    sourceDocuments: string[]
    counterpartyAccounts: string[]
    counterpartyName?: string
    counterpartyTaxId?: string
  }
}

export type ReconciliationMatch = {
  id: string
  bankIds: string[]
  accountingIds: string[]
  createdAt: string
  reason: string
  confidence?: number
}

// Agrupa os movimentos trazidos pela mesma importação (mesmo ficheiro/leitura), para permitir
// anular tudo de uma vez se a importação tiver sido feita na conta errada ou tiver dados a mais.
export type ImportBatch = {
  id: string
  account: string
  source: MovementSource
  fileName: string
  importedAt: string
  movementCount: number
}
