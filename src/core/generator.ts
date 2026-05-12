import { Templates } from './templates'
import { PostingModel } from './models'
import { setRange, setRightAlignedFieldEndingAt, stripAccents, toAmountString } from './utils'

export type InputRow = {
  date: Date
  description: string
  amount: number
}

export type GenerateOptions = {
  ano: number
  diario: string
  documento: string
  startNumDiario: number
}

export type PostingLinePreview = {
  account: string
  dc: 'C' | 'D'
  amount: number
  raw: string
}

export type PostingEntryPreview = {
  rowIndex: number
  numDiario: number
  numDoc: string
  dateISO: string
  description: string
  credit: PostingLinePreview
  debit: PostingLinePreview
}

function ddmm(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return dd + mm
}

function makeNumDoc(numDiario: number, documento: string): string {
  // numdiario is typically 6 digits + documento (3 digits) => 9
  const nd = String(numDiario).padStart(6, '0')
  const doc = String(documento).padStart(3, '0')
  return nd + doc
}

function toPostingIsoDate(d: Date, ano: number): string {
  const yyyy = toYearString(ano)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toYearString(ano: number): string {
  return String(ano).padStart(4, '0').slice(-4)
}

function buildPostingLines(model: PostingModel, row: InputRow, opts: GenerateOptions, rowIndex: number) {
  const layout = Templates.v10_rhp
  const f = layout.field
  const numDiario = opts.startNumDiario + rowIndex
  const numDoc = makeNumDoc(numDiario, opts.documento)
  const dateStr = ddmm(row.date)
  const yearStr = toYearString(opts.ano)
  const desc = stripAccents(row.description)
  const amtNum = Math.abs(row.amount)
  const amt = toAmountString(amtNum)

  // credit line
  let creditLine = model.creditTemplate
  creditLine = setRange(creditLine, f.dateStart, f.dateLen, dateStr)
  creditLine = setRange(creditLine, f.accountStart, f.accountLen, (model.creditAccountFixed ?? '').trim())
  creditLine = setRange(creditLine, f.diarioStart, f.diarioLen, opts.diario)
  creditLine = setRange(creditLine, f.numDocStart, f.numDocLen, numDoc)
  creditLine = setRange(creditLine, f.descStart, f.descLen, desc)
  creditLine = setRightAlignedFieldEndingAt(creditLine, f.amountEnd, f.amountFieldLen, amt)
  creditLine = creditLine.substring(0, f.dcPos) + 'C' + creditLine.substring(f.dcPos + 1)
  creditLine = setRange(creditLine, f.yearStart, f.yearLen, yearStr)

  // debit line
  let debitLine = model.debitTemplate
  debitLine = setRange(debitLine, f.dateStart, f.dateLen, dateStr)
  debitLine = setRange(debitLine, f.accountStart, f.accountLen, (model.debitAccountFixed ?? '').trim())
  debitLine = setRange(debitLine, f.diarioStart, f.diarioLen, opts.diario)
  debitLine = setRange(debitLine, f.numDocStart, f.numDocLen, numDoc)
  debitLine = setRange(debitLine, f.descStart, f.descLen, desc)
  debitLine = setRightAlignedFieldEndingAt(debitLine, f.amountEnd, f.amountFieldLen, amt)
  debitLine = debitLine.substring(0, f.dcPos) + 'D' + debitLine.substring(f.dcPos + 1)
  debitLine = setRange(debitLine, f.yearStart, f.yearLen, yearStr)

  return {
    rowIndex,
    numDiario,
    numDoc,
    dateISO: toPostingIsoDate(row.date, opts.ano),
    description: row.description,
    amount: amtNum,
    creditLine,
    debitLine,
  }
}

export function buildPostingPreview(model: PostingModel, rows: InputRow[], opts: GenerateOptions): PostingEntryPreview[] {
  return rows.map((row, rowIndex) => {
    const built = buildPostingLines(model, row, opts, rowIndex)

    return {
      rowIndex: built.rowIndex,
      numDiario: built.numDiario,
      numDoc: built.numDoc,
      dateISO: built.dateISO,
      description: built.description,
      credit: {
        account: (model.creditAccountFixed ?? '').trim(),
        dc: 'C',
        amount: built.amount,
        raw: built.creditLine,
      },
      debit: {
        account: (model.debitAccountFixed ?? '').trim(),
        dc: 'D',
        amount: built.amount,
        raw: built.debitLine,
      },
    }
  })
}

export function generateTxt(model: PostingModel, rows: InputRow[], opts: GenerateOptions): string {
  const layout = Templates.v10_rhp
  const headers = layout.headers.join('\n') + '\n\n'
  let out = headers

  rows.forEach((row, rowIndex) => {
    const built = buildPostingLines(model, row, opts, rowIndex)
    out += built.creditLine + '\n' + built.debitLine + '\n'
  })

  return out
}
