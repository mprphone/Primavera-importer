import { normalizeForMatch } from '../../core/utils'
import { descendants, parseSaftDocument, text, xmlFromFile } from '../../core/saft-xml'
import { BankMovement } from './types'

type SaftEntity = { name: string; taxId: string }

export type SaftBankingResult = {
  movements: BankMovement[]
  fiscalYear: string
  companyName: string
  companyTaxId: string
  openingBalance: number | null
}

export type SaftMergeResult = {
  movements: BankMovement[]
  enriched: number
  added: number
}

function entityMap(document: XMLDocument) {
  const byId = new Map<string, SaftEntity>()
  const byAccount = new Map<string, SaftEntity>()
  for (const tag of ['Customer', 'Supplier']) {
    for (const entity of Array.from(document.getElementsByTagNameNS('*', tag))) {
      const id = text(entity, `${tag}ID`)
      if (!id) continue
      const value = {
        name: text(entity, 'CompanyName'),
        taxId: text(entity, `${tag}TaxID`).replace(/\D/g, '').slice(-9),
      }
      byId.set(id, value)
      const account = text(entity, 'AccountID')
      if (account) byAccount.set(account, value)
    }
  }
  return { byId, byAccount }
}

function safeId(value: string) {
  return normalizeForMatch(value).replace(/\s+/g, '-').slice(0, 80)
}

export async function parseSaftForBanking(file: File, account: string, month: string): Promise<SaftBankingResult> {
  if (!account) throw new Error('Seleciona primeiro a conta bancária a enriquecer.')
  const xml = await xmlFromFile(file)
  const document = parseSaftDocument(xml)

  const auditFile = document.documentElement
  const header = descendants(auditFile, 'Header')[0] ?? auditFile
  const entities = entityMap(document)
  const accountNames = new Map(descendants(auditFile, 'Account').map(item => [text(item, 'AccountID'), text(item, 'AccountDescription')]))
  const importedAt = new Date().toISOString()
  const result: BankMovement[] = []

  for (const journal of descendants(auditFile, 'Journal')) {
    const journalId = text(journal, 'JournalID')
    for (const transaction of Array.from(journal.children).filter(child => child.localName === 'Transaction')) {
      const transactionId = text(transaction, 'TransactionID')
      const transactionDate = text(transaction, 'TransactionDate') || text(transaction, 'GLPostingDate')
      const transactionDescription = text(transaction, 'Description')
      const postingNumber = text(transaction, 'DocArchivalNumber')
      const entityId = text(transaction, 'CustomerID') || text(transaction, 'SupplierID')
      const lines = descendants(transaction, 'DebitLine').concat(descendants(transaction, 'CreditLine'))
      const sourceDocuments = Array.from(new Set(lines.flatMap(line => descendants(line, 'SourceDocumentID').map(item => item.textContent?.trim() ?? '')).filter(Boolean)))
      const counterpartyAccounts = Array.from(new Set(lines.map(line => text(line, 'AccountID')).filter(lineAccount => lineAccount && lineAccount !== account)))
      const entity = entities.byId.get(entityId) || counterpartyAccounts.map(lineAccount => entities.byAccount.get(lineAccount)).find(Boolean)
      const counterpartyName = entity?.name || counterpartyAccounts.map(lineAccount => accountNames.get(lineAccount)).find(Boolean)

      for (const line of lines.filter(item => text(item, 'AccountID') === account)) {
        const debit = Number(text(line, 'DebitAmount')) || 0
        const credit = Number(text(line, 'CreditAmount')) || 0
        const amount = debit || -credit
        if (!transactionDate || !amount) continue
        const recordId = text(line, 'RecordID') || String(result.length + 1)
        result.push({
          id: `movement-accounting-saft-${safeId(transactionId)}-${safeId(recordId)}`,
          source: 'accounting',
          account,
          date: transactionDate,
          description: text(line, 'Description') || transactionDescription,
          reference: sourceDocuments.join(' · ') || postingNumber,
          nif: entity?.taxId || undefined,
          amount,
          nature: debit ? 'D' : 'C',
          status: 'pending',
          importedAt,
          saft: {
            transactionId,
            journal: journalId,
            postingNumber,
            sourceDocuments,
            counterpartyAccounts,
            counterpartyName: counterpartyName || undefined,
            counterpartyTaxId: entity?.taxId || undefined,
          },
        })
      }
    }
  }

  const accountMaster = descendants(auditFile, 'Account').find(item => text(item, 'AccountID') === account)
  const yearOpening = accountMaster
    ? (Number(text(accountMaster, 'OpeningDebitBalance')) || 0) - (Number(text(accountMaster, 'OpeningCreditBalance')) || 0)
    : null
  const monthStart = `${month}-01`
  const openingBalance = yearOpening === null
    ? null
    : yearOpening + result.filter(item => item.date < monthStart).reduce((sum, item) => sum + item.amount, 0)

  return {
    movements: result,
    fiscalYear: text(header, 'FiscalYear'),
    companyName: text(header, 'CompanyName'),
    companyTaxId: text(header, 'TaxRegistrationNumber'),
    openingBalance,
  }
}

function exactKey(item: BankMovement) {
  return [item.account, item.date, Math.abs(item.amount).toFixed(2), normalizeForMatch(item.description)].join('|')
}

function looseKey(item: BankMovement) {
  return [item.account, item.date, Math.abs(item.amount).toFixed(2)].join('|')
}

export function mergeSaftMovements(current: BankMovement[], imported: BankMovement[]): SaftMergeResult {
  const next = [...current]
  const used = new Set<number>()
  let enriched = 0
  let added = 0

  for (const saftMovement of imported) {
    let index = next.findIndex((item, itemIndex) => !used.has(itemIndex) && item.source === 'accounting' && exactKey(item) === exactKey(saftMovement))
    if (index < 0) {
      const looseCandidates = next
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter(({ item, itemIndex }) => !used.has(itemIndex) && item.source === 'accounting' && looseKey(item) === looseKey(saftMovement))
      if (looseCandidates.length === 1) index = looseCandidates[0].itemIndex
    }
    if (index >= 0) {
      used.add(index)
      next[index] = {
        ...next[index],
        nif: next[index].nif || saftMovement.nif,
        saft: saftMovement.saft,
      }
      enriched += 1
    } else if (!next.some(item => item.id === saftMovement.id)) {
      next.push(saftMovement)
      added += 1
    }
  }

  return { movements: next, enriched, added }
}
