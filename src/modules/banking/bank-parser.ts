import * as XLSX from 'xlsx'
import { BankMovement, MovementNature, MovementSource } from './types'

export type BankFileFormat = 'signed_amount' | 'debit_credit'

const aliases = {
  date: ['data', 'data_movimento', 'data_valor', 'data_operacao', 'data_da_operacao'],
  description: ['descricao', 'descritivo', 'movimento', 'descricao_da_conta', 'historico'],
  reference: ['referencia', 'documento', 'numero_documento', 'n_documento'],
  amount: ['valor', 'montante', 'importe', 'total'],
  debit: ['debito', 'valor_debito', 'debit'],
  credit: ['credito', 'valor_credito', 'credit'],
  nif: ['nif', 'contribuinte', 'nif_entidade'],
  iban: ['iban', 'conta_iban', 'numero_conta'],
} as const

function fold(value: unknown) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function number(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(/[€$]/g, '')
  const parsed = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text)
  return Number.isFinite(parsed) ? parsed : 0
}

function date(value: unknown) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  const text = String(value ?? '').trim().slice(0, 10)
  const pt = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (pt) return `${pt[3]}-${pt[2]}-${pt[1]}`
  const iso = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : ''
}

function pick(row: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    if (row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== '') return row[field]
  }
  return ''
}

// O utilizador escolhe explicitamente o formato do ficheiro em vez de o adivinharmos pelo nome
// das colunas: cada banco exporta de forma diferente (algumas colunas "Débito"/"Crédito" só têm
// uma etiqueta de texto, não o valor), e adivinhar mal troca o sinal sem dar erro nenhum.
function amountAndNature(row: Record<string, unknown>, source: MovementSource, format: BankFileFormat) {
  if (format === 'debit_credit') {
    const debit = Math.abs(number(pick(row, aliases.debit)))
    const credit = Math.abs(number(pick(row, aliases.credit)))
    const nature: MovementNature = debit ? 'D' : 'C'
    const absolute = debit || credit
    return { nature, amount: source === 'bank' ? (nature === 'D' ? -absolute : absolute) : (nature === 'D' ? absolute : -absolute) }
  }
  const amount = number(pick(row, aliases.amount))
  const nature: MovementNature = source === 'bank'
    ? (amount < 0 ? 'D' : 'C')
    : (amount >= 0 ? 'D' : 'C')
  return { nature, amount }
}

export type ParseSkipReason = 'noDate' | 'noDescription' | 'noAmount'

export type ParseBankFileResult = {
  movements: BankMovement[]
  totalRows: number
  skipped: Record<ParseSkipReason, number>
}

export async function parseBankFile(
  file: File,
  source: MovementSource,
  account: string,
  format: BankFileFormat = 'signed_amount',
  importBatchId?: string,
): Promise<ParseBankFileResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const importedAt = new Date().toISOString()
  const skipped: Record<ParseSkipReason, number> = { noDate: 0, noDescription: 0, noAmount: 0 }

  const movements = rows.flatMap((raw, index) => {
    const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [fold(key), value]))
    const movementDate = date(pick(row, aliases.date))
    const description = String(pick(row, aliases.description)).trim()
    const reference = String(pick(row, aliases.reference)).trim()
    const nif = String(pick(row, aliases.nif)).replace(/\D/g, '').slice(0, 9)
    const iban = String(pick(row, aliases.iban)).replace(/\s/g, '').toUpperCase()
    const value = amountAndNature(row, source, format)
    if (!movementDate) { skipped.noDate += 1; return [] }
    if (!description) { skipped.noDescription += 1; return [] }
    if (!value.amount) { skipped.noAmount += 1; return [] }
    // O índice da linha vai sempre explícito no id (nunca dependente do hash): truncar um hash
    // base64 a um nº fixo de carateres descartava o sufixo onde o índice ficava codificado,
    // fazendo colidir linhas diferentes com descrições longas (bug real: 290 linhas → só 187 sobreviviam).
    const identity = `${source}|${account}|${movementDate}|${reference}|${description}|${value.amount}`
    const hash = btoa(unescape(encodeURIComponent(identity))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    return [{
      id: `movement-${source}-${index}-${hash}`,
      source,
      account,
      date: movementDate,
      description,
      reference,
      nif: nif || undefined,
      iban: iban || undefined,
      amount: value.amount,
      nature: value.nature,
      status: 'pending' as const,
      importedAt,
      importBatchId,
    }]
  })

  return { movements, totalRows: rows.length, skipped }
}
