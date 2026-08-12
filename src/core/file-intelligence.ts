import * as XLSX from 'xlsx'

export type DetectedFileKind = 'bank' | 'efatura' | 'accounting' | 'unknown'
export type DetectedAmountFormat = 'signed_amount' | 'debit_credit'

export type FileAnalysis = {
  fileName: string
  kind: DetectedFileKind
  kindConfidence: number
  bankName: string
  separator: string
  dateFormat: string
  amountFormat: DetectedAmountFormat
  headers: string[]
  mapped: Record<string, string>
  sample: Array<Record<string, string>>
  warnings: string[]
}

const fold = (value: unknown) => String(value ?? '').trim().toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const fieldAliases: Record<string, string[]> = {
  date: ['data', 'data_movimento', 'data_valor', 'data_operacao', 'data_emissao'],
  description: ['descricao', 'descritivo', 'movimento', 'historico', 'emitente', 'fornecedor'],
  reference: ['referencia', 'documento', 'numero_documento', 'n_documento', 'atcud'],
  amount: ['valor', 'montante', 'importe', 'total', 'valor_total'],
  debit: ['debito', 'valor_debito', 'debit'],
  credit: ['credito', 'valor_credito', 'credit'],
  nif: ['nif', 'nif_emitente', 'nif_fornecedor', 'contribuinte'],
  iban: ['iban', 'conta_iban', 'numero_conta'],
  vat: ['iva', 'valor_iva', 'imposto'],
}

function detectSeparator(text: string) {
  const first = text.split(/\r?\n/).find(Boolean) ?? ''
  const scores = [{ value: ';', count: first.split(';').length }, { value: ',', count: first.split(',').length }, { value: '\t', count: first.split('\t').length }]
  return scores.sort((a, b) => b.count - a.count)[0].count > 1 ? scores[0].value.replace('\t', 'tabulação') : 'Excel'
}

export async function analyzeFile(file: File): Promise<FileAnalysis> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
  const headers = rows[0] ? Object.keys(rows[0]) : []
  const normalized = new Map(headers.map(header => [fold(header), header]))
  const mapped = Object.fromEntries(Object.entries(fieldAliases).flatMap(([field, aliases]) => {
    const found = aliases.find(alias => normalized.has(alias))
    return found ? [[field, normalized.get(found)!]] : []
  }))
  const lowerName = file.name.toLowerCase()
  const hasVat = Boolean(mapped.vat || mapped.nif)
  const hasDebitCredit = Boolean(mapped.debit && mapped.credit)
  const hasBankFields = Boolean(mapped.date && mapped.description && (mapped.amount || hasDebitCredit))
  const kind: DetectedFileKind = hasVat ? 'efatura' : hasBankFields ? (/razao|ledger|contab/.test(lowerName) ? 'accounting' : 'bank') : 'unknown'
  const kindConfidence = kind === 'unknown' ? 25 : Math.min(98, 55 + Object.keys(mapped).length * 7)
  const joined = `${lowerName} ${headers.join(' ')}`.toLowerCase()
  const bankName = [['Millennium BCP', /millennium|bcp/], ['Santander', /santander|totta/], ['CGD', /caixa geral|cgd/], ['Novo Banco', /novo banco/], ['BPI', /\bbpi\b/], ['ActivoBank', /activobank/]].find(([, pattern]) => (pattern as RegExp).test(joined))?.[0] as string ?? 'Não identificado'
  const firstDate = rows.slice(0, 10).map(row => mapped.date ? String(row[mapped.date]) : '').find(Boolean) ?? ''
  const dateFormat = /^\d{4}[-/]\d{2}/.test(firstDate) ? 'AAAA-MM-DD' : /^\d{2}[-/]\d{2}[-/]\d{4}/.test(firstDate) ? 'DD-MM-AAAA' : 'Automático/Excel'
  const warnings = [!mapped.date && 'Coluna de data não identificada', !mapped.description && 'Descrição não identificada', !mapped.amount && !hasDebitCredit && 'Valor não identificado', kind === 'unknown' && 'Tipo de ficheiro incerto; confirma o mapeamento'].filter(Boolean) as string[]
  return {
    fileName: file.name, kind, kindConfidence, bankName,
    separator: /\.csv$/i.test(file.name) ? detectSeparator(new TextDecoder().decode(buffer.slice(0, 4096))) : 'Excel',
    dateFormat, amountFormat: hasDebitCredit ? 'debit_credit' : 'signed_amount', headers, mapped,
    sample: rows.slice(0, 5).map(row => Object.fromEntries(headers.slice(0, 8).map(header => [header, String(row[header] ?? '')]))), warnings,
  }
}
