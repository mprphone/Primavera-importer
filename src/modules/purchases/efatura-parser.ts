import * as XLSX from 'xlsx'
import { EfaturaImportResult, PurchaseInvoice } from './types'
import { EfaturaPortalRow } from './efatura-client'

const aliases = {
  documentDate: ['data_emissao', 'data', 'data_documento', 'data_da_fatura'],
  documentNo: ['numero_documento', 'n_documento', 'numero_fatura', 'fatura', 'documento', 'atcud'],
  supplierName: ['emitente', 'fornecedor', 'nome_emitente', 'designacao'],
  supplierNif: ['nif_emitente', 'nif_fornecedor', 'nif', 'contribuinte'],
  description: ['descricao', 'setor', 'sector', 'atividade', 'tipo_despesa', 'tipo'],
  netAmount: ['base_tributavel', 'valor_sem_iva', 'base', 'valor_liquido'],
  vatAmount: ['iva', 'valor_iva', 'imposto'],
  totalAmount: ['total', 'valor_total', 'valor_fatura', 'importancia'],
  status: ['situacao', 'situacao_do_documento', 'estado', 'estado_do_documento'],
} as const

function foldHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseDate(value: unknown): string {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  const text = String(value ?? '').trim().slice(0, 10)
  const portuguese = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (portuguese) return `${portuguese[3]}-${portuguese[2]}-${portuguese[1]}`
  const iso = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : ''
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(/[€$]/g, '')
  if (!text) return 0
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function pick(row: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    const value = row[field]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return ''
}

function normalizeRow(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [foldHeader(key), value]))
}

export async function parseEfaturaFile(file: File): Promise<EfaturaImportResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const invoices: PurchaseInvoice[] = []
  let ignored = 0

  rows.forEach((raw, index) => {
    const row = normalizeRow(raw)
    const documentDate = parseDate(pick(row, aliases.documentDate))
    const documentNo = String(pick(row, aliases.documentNo)).trim()
    const supplierRaw = String(pick(row, aliases.supplierName)).trim()
    const explicitNif = String(pick(row, aliases.supplierNif)).replace(/\D/g, '').slice(0, 9)
    const embeddedNif = supplierRaw.match(/\b\d{9}\b/)?.[0] ?? ''
    const supplierNif = explicitNif || embeddedNif
    const supplierName = supplierRaw.replace(/^\s*\d{9}\s*-?\s*/, '').trim()
    if (!documentDate || !documentNo) {
      ignored += 1
      return
    }
    // A exportação da AT pode incluir documentos anulados; um documento anulado nunca chega a
    // ser lançado na contabilidade, por isso apareceria sempre como "não confirmada" sem motivo.
    if (String(pick(row, aliases.status)).toLowerCase().includes('anulad')) {
      ignored += 1
      return
    }

    const vatAmount = Math.abs(parseNumber(pick(row, aliases.vatAmount)))
    const totalRaw = Math.abs(parseNumber(pick(row, aliases.totalAmount)))
    const netRaw = Math.abs(parseNumber(pick(row, aliases.netAmount)))
    const netAmount = netRaw || Math.max(0, totalRaw - vatAmount)
    const totalAmount = totalRaw || netAmount + vatAmount
    if (!totalAmount) {
      ignored += 1
      return
    }
    const sourceKey = [documentDate, documentNo, supplierNif].join('|')

    invoices.push({
      id: `purchase-${sourceKey || index}`,
      sourceKey,
      documentDate,
      documentNo,
      supplierName,
      supplierNif,
      description: String(pick(row, aliases.description) || 'Importado do e-Fatura').trim(),
      netAmount,
      vatAmount,
      totalAmount,
      expenseAccount: '',
      vatCode: '',
      supplierAccount: '',
      journal: '',
      documentType: '',
      paid: false,
      paymentAccount: '',
      selected: true,
      status: 'pending',
      reviewedAt: '',
    })
  })

  return { invoices, ignored }
}

export function parseEfaturaPortalRows(rows: EfaturaPortalRow[]): EfaturaImportResult {
  const invoices: PurchaseInvoice[] = []
  let ignored = 0
  rows.forEach((row, index) => {
    const documentDate = parseDate(row.document_date)
    const documentNo = String(row.document_no ?? '').trim()
    const supplierRaw = String(row.party_name ?? '').trim()
    const supplierNif = String(row.party_nif ?? '').replace(/\D/g, '').slice(0, 9)
    const vatAmount = Math.abs(parseNumber(row.vat_amount))
    const totalRaw = Math.abs(parseNumber(row.total_amount))
    const netRaw = Math.abs(parseNumber(row.net_amount))
    const netAmount = netRaw || Math.max(0, totalRaw - vatAmount)
    const totalAmount = totalRaw || netAmount + vatAmount
    if (!documentDate || !documentNo || !totalAmount) {
      ignored += 1
      return
    }
    const sourceKey = [documentDate, documentNo, supplierNif].join('|')
    invoices.push({
      id: `purchase-${sourceKey || index}`,
      sourceKey,
      documentDate,
      documentNo,
      supplierName: supplierRaw,
      supplierNif,
      description: String(row.description || 'Importado do e-Fatura').trim(),
      netAmount,
      vatAmount,
      totalAmount,
      expenseAccount: '',
      vatCode: '',
      supplierAccount: '',
      journal: '',
      documentType: '',
      paid: false,
      paymentAccount: '',
      selected: true,
      status: 'pending',
      reviewedAt: '',
    })
  })
  return { invoices, ignored }
}
