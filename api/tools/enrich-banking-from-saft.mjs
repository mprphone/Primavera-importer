import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const [, , clientId, account, ...saftPaths] = process.argv
if (!clientId || !account || !saftPaths.length) {
  throw new Error('Uso: node api/tools/enrich-banking-from-saft.mjs <cliente> <conta> <saft.xml|saft.zip> [...]')
}

const root = resolve(import.meta.dirname, '../..')
const bankingPath = resolve(root, 'api/runtime/store', clientId, 'banking.json')
const state = JSON.parse(readFileSync(bankingPath, 'utf8'))

const decodeEntities = value => value
  .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&apos;', "'")

const field = (xml, name) => decodeEntities(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() ?? '')
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const exactKey = item => [item.account, item.date, Math.abs(item.amount).toFixed(2), normalize(item.description)].join('|')
const looseKey = item => [item.account, item.date, Math.abs(item.amount).toFixed(2)].join('|')

function readSaft(path) {
  const absolute = resolve(root, path)
  const bytes = path.toLowerCase().endsWith('.zip')
    ? execFileSync('unzip', ['-p', absolute], { maxBuffer: 100 * 1024 * 1024 })
    : readFileSync(absolute)
  return new TextDecoder('windows-1252').decode(bytes)
}

function entitiesFrom(xml) {
  const byId = new Map()
  const byAccount = new Map()
  for (const tag of ['Customer', 'Supplier']) {
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
    for (const match of xml.matchAll(pattern)) {
      const id = field(match[1], `${tag}ID`)
      if (!id) continue
      const value = {
        name: field(match[1], 'CompanyName'),
        taxId: field(match[1], `${tag}TaxID`).replace(/\D/g, '').slice(-9),
      }
      byId.set(id, value)
      const entityAccount = field(match[1], 'AccountID')
      if (entityAccount) byAccount.set(entityAccount, value)
    }
  }
  return { byId, byAccount }
}

function accountNamesFrom(xml) {
  const result = new Map()
  const ledgerAccounts = field(xml, 'GeneralLedgerAccounts')
  for (const match of ledgerAccounts.matchAll(/<Account>([\s\S]*?)<\/Account>/g)) {
    result.set(field(match[1], 'AccountID'), field(match[1], 'AccountDescription'))
  }
  return result
}

function contextsFrom(xml) {
  const entities = entitiesFrom(xml)
  const accountNames = accountNamesFrom(xml)
  const contexts = []
  for (const journalMatch of xml.matchAll(/<Journal>([\s\S]*?)<\/Journal>/g)) {
    const journalXml = journalMatch[1]
    const journal = field(journalXml, 'JournalID')
    for (const transactionMatch of journalXml.matchAll(/<Transaction>([\s\S]*?)<\/Transaction>/g)) {
      const transaction = transactionMatch[1]
      const transactionId = field(transaction, 'TransactionID')
      const date = field(transaction, 'TransactionDate') || field(transaction, 'GLPostingDate')
      const postingNumber = field(transaction, 'DocArchivalNumber')
      const entityId = field(transaction, 'CustomerID') || field(transaction, 'SupplierID')
      const lines = Array.from(transaction.matchAll(/<(DebitLine|CreditLine)>([\s\S]*?)<\/\1>/g))
      const sourceDocuments = [...new Set(lines.map(match => field(match[2], 'SourceDocumentID')).filter(Boolean))]
      const counterpartyAccounts = [...new Set(lines.map(match => field(match[2], 'AccountID')).filter(value => value && value !== account))]
      const entity = entities.byId.get(entityId) || counterpartyAccounts.map(lineAccount => entities.byAccount.get(lineAccount)).find(Boolean)
      const counterpartyName = entity?.name || counterpartyAccounts.map(lineAccount => accountNames.get(lineAccount)).find(Boolean)
      for (const lineMatch of lines) {
        const line = lineMatch[2]
        if (field(line, 'AccountID') !== account) continue
        const debit = Number(field(line, 'DebitAmount')) || 0
        const credit = Number(field(line, 'CreditAmount')) || 0
        const amount = debit || -credit
        if (!date || !amount) continue
        contexts.push({
          account,
          date,
          amount,
          description: field(line, 'Description') || field(transaction, 'Description'),
          nif: entity?.taxId || undefined,
          saft: {
            transactionId,
            journal,
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
  return contexts
}

const contexts = saftPaths.flatMap(path => contextsFrom(readSaft(path)))
const exact = new Map()
const loose = new Map()
for (const context of contexts) {
  const exactItems = exact.get(exactKey(context)) ?? []
  exactItems.push(context)
  exact.set(exactKey(context), exactItems)
  const looseItems = loose.get(looseKey(context)) ?? []
  looseItems.push(context)
  loose.set(looseKey(context), looseItems)
}

let enriched = 0
for (const movement of state.movements) {
  if (movement.source !== 'accounting' || movement.account !== account) continue
  const exactItems = exact.get(exactKey(movement)) ?? []
  let context = exactItems.shift()
  if (!context) {
    const looseItems = loose.get(looseKey(movement)) ?? []
    if (looseItems.length === 1) context = looseItems.shift()
  }
  if (!context) continue
  movement.nif ||= context.nif
  movement.saft = context.saft
  enriched += 1
}

writeFileSync(bankingPath, `${JSON.stringify(state, null, 2)}\n`)
console.log(`${basename(bankingPath)}: ${enriched}/${state.movements.filter(item => item.source === 'accounting' && item.account === account).length} movimentos enriquecidos com SAF-T.`)
