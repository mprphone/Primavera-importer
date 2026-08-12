import { Templates } from '../../core/templates'
import { setRange, setRightAlignedFieldEndingAt, stripAccents, toAmountString } from '../../core/utils'
import { BankMovement } from '../banking/types'
import { PostingDraft } from './types'

export type PostingEntry = {
  movement: BankMovement
  draft: PostingDraft
}

const lineTemplate = 'SNNFP31121290                32       120201321  -1        DOCUMENTO                                                       0.00C                                           1                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00'

function buildLine(entry: PostingEntry, account: string, amount: number, dc: 'D' | 'C', year: number, number: number, order: number) {
  const fields = Templates.v10_rhp.field
  const date = new Date(`${entry.movement.date}T12:00:00`)
  const ddmm = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}`
  const numDoc = `${String(number).padStart(6, '0')}${String(entry.draft.documentType).padStart(3, '0')}`
  const description = stripAccents(`${entry.movement.reference} ${entry.movement.description}`.trim())
  let line = lineTemplate
  line = setRange(line, fields.dateStart, fields.dateLen, ddmm)
  line = setRange(line, fields.accountStart, fields.accountLen, account)
  line = setRange(line, fields.diarioStart, fields.diarioLen, entry.draft.journal)
  line = setRange(line, fields.numDocStart, fields.numDocLen, numDoc)
  line = setRange(line, fields.descStart, fields.descLen, description)
  line = setRightAlignedFieldEndingAt(line, fields.amountEnd, fields.amountFieldLen, toAmountString(amount))
  line = line.substring(0, fields.dcPos) + dc + line.substring(fields.dcPos + 1)
  line = setRange(line, fields.yearStart, fields.yearLen, String(year))
  return setRange(line, 171, 1, String(order))
}

export function generatePostingsTxt(entries: PostingEntry[], year: number, startNumber: number) {
  const headers = `${Templates.v10_rhp.headers.join('\n')}\n\n`
  const lines: string[] = []
  entries.forEach((entry, index) => {
    const number = startNumber + index
    const absolute = Math.abs(entry.movement.amount)
    // O "amount" do movimento já tem sinal coerente com o efeito no saldo (positivo = entrada,
    // negativo = saída), independentemente de como o extrato do banco rotula a sua própria
    // coluna D/C — por isso o débito/crédito contabilístico da conta 12 vem sempre do sinal,
    // nunca da "nature" do extrato (que pode usar a convenção inversa).
    const bankDc: 'D' | 'C' = entry.movement.amount >= 0 ? 'D' : 'C'
    const counterDc: 'D' | 'C' = bankDc === 'D' ? 'C' : 'D'
    lines.push(buildLine(entry, entry.movement.account, absolute, bankDc, year, number, 1))
    lines.push(buildLine(entry, entry.draft.counterAccount, absolute, counterDc, year, number, 2))
  })
  return headers + lines.join('\n') + '\n'
}

export function validatePostingsForExport(entries: PostingEntry[]) {
  if (!entries.length) return 'Seleciona pelo menos um movimento.'
  const invalid = entries.find(entry =>
    !entry.draft.counterAccount.trim() || !entry.draft.journal.trim() || !entry.draft.documentType.trim()
  )
  return invalid ? `Completa a conta de contrapartida, diário e documento do movimento "${invalid.movement.description}".` : ''
}
