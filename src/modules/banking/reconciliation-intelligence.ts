import { normalizeForMatch } from '../../core/utils'
import { BankMovement } from './types'

export type MatchSuggestion = { bank: BankMovement; accounting: BankMovement; confidence: number; reasons: string[]; ambiguous: boolean }
export type GroupMatchSuggestion = { bank: BankMovement; accounting: BankMovement[]; confidence: number; reasons: string[]; ambiguous: boolean }
export type MovementAnomaly = { movementId: string; severity: 'warning' | 'critical'; message: string }

const dayDiff = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000
const tokens = (value: string) => new Set(normalizeForMatch(value).split(' ').filter(token => token.length > 2))

function textSimilarity(a: string, b: string) {
  const left = tokens(a); const right = tokens(b)
  const common = [...left].filter(token => right.has(token)).length
  return common / Math.max(left.size, right.size, 1)
}

function accountingContext(item: BankMovement) {
  return [
    item.description,
    item.reference,
    item.saft?.counterpartyName,
    item.saft?.counterpartyTaxId,
    item.saft?.sourceDocuments.join(' '),
  ].filter(Boolean).join(' ')
}

function sourceDocumentMatch(bank: BankMovement, accounting: BankMovement) {
  const bankText = normalizeForMatch(`${bank.description} ${bank.reference}`)
  return Boolean(accounting.saft?.sourceDocuments.some(document => {
    const normalized = normalizeForMatch(document)
    return normalized.length >= 5 && bankText.includes(normalized)
  }))
}

export function findAdvancedMatches(movements: BankMovement[], toleranceDays: number): MatchSuggestion[] {
  const banks = movements.filter(item => item.source === 'bank' && item.status === 'pending')
  const accounting = movements.filter(item => item.source === 'accounting' && item.status === 'pending')
  return banks.map(bank => {
    const options = accounting.map(item => {
      const amountDelta = Math.abs(Math.abs(bank.amount) - Math.abs(item.amount))
      const amountScore = amountDelta < 0.005 ? 1 : Math.max(0, 1 - amountDelta / Math.max(Math.abs(bank.amount), 1))
      const days = dayDiff(bank.date, item.date)
      const dateScore = Math.max(0, 1 - days / Math.max(toleranceDays + 1, 1))
      const bankText = `${bank.description} ${bank.reference}`
      const descriptionScore = textSimilarity(bankText, `${item.description} ${item.reference}`)
      const saftCounterpartyScore = item.saft?.counterpartyName ? textSimilarity(bankText, item.saft.counterpartyName) : 0
      const documentMatch = sourceDocumentMatch(bank, item)
      const nifMatch = Boolean(bank.nif && (item.nif === bank.nif || item.saft?.counterpartyTaxId === bank.nif))
      const ibanMatch = Boolean(bank.iban && item.iban && bank.iban === item.iban)
      const historyMatch = movements.some(previous => previous.status === 'reconciled' && previous.source === 'bank' && textSimilarity(previous.description, bank.description) > .65 && previous.matchId && movements.some(peer => peer.matchId === previous.matchId && peer.source === 'accounting' && textSimilarity(accountingContext(peer), accountingContext(item)) > .65))
      const confidence = Math.round(Math.min(99, (amountScore * 0.44 + dateScore * 0.15 + descriptionScore * 0.11 + saftCounterpartyScore * 0.14 + (documentMatch ? .1 : 0) + (nifMatch ? .09 : 0) + (ibanMatch ? .05 : 0) + (historyMatch ? .07 : 0)) * 100))
      const reasons = [amountDelta < 0.005 && 'valor exato', days <= toleranceDays && `${days} dias`, descriptionScore >= 0.3 && 'descrição semelhante', saftCounterpartyScore >= .3 && 'contrapartida SAF-T', documentMatch && 'documento SAF-T', nifMatch && 'NIF igual', ibanMatch && 'IBAN igual', historyMatch && 'histórico semelhante'].filter(Boolean) as string[]
      return { bank, accounting: item, confidence, reasons, ambiguous: false }
    }).sort((a, b) => b.confidence - a.confidence)
    if (options[0]) options[0].ambiguous = Boolean(options[1] && options[0].confidence - options[1].confidence <= 5)
    return options[0]
  }).filter((item): item is MatchSuggestion => Boolean(item && item.confidence >= 70)).sort((a, b) => b.confidence - a.confidence)
}

export function findGroupMatches(movements: BankMovement[], toleranceDays: number): GroupMatchSuggestion[] {
  const banks = movements.filter(item => item.source === 'bank' && item.status === 'pending')
  const accounting = movements.filter(item => item.source === 'accounting' && item.status === 'pending')
  const suggestions: GroupMatchSuggestion[] = []
  for (const bank of banks) {
    const nearby = accounting.filter(item => dayDiff(bank.date, item.date) <= toleranceDays).slice(0, 30)
    const candidates: BankMovement[][] = []
    for (let i = 0; i < nearby.length; i += 1) for (let j = i + 1; j < nearby.length; j += 1) {
      candidates.push([nearby[i], nearby[j]])
      for (let k = j + 1; k < nearby.length && k < j + 8; k += 1) candidates.push([nearby[i], nearby[j], nearby[k]])
    }
    const exact = candidates.filter(group => Math.abs(group.reduce((sum, item) => sum + Math.abs(item.amount), 0) - Math.abs(bank.amount)) < .005)
      .map(group => ({ group, similarity: Math.max(...group.map(item => textSimilarity(`${bank.description} ${bank.reference}`, accountingContext(item)))) }))
      .sort((a, b) => b.similarity - a.similarity)
    if (!exact[0]) continue
    const confidence = Math.round(Math.min(96, 82 + exact[0].similarity * 14))
    suggestions.push({ bank, accounting: exact[0].group, confidence, reasons: ['soma exata', `${exact[0].group.length} movimentos`, exact[0].similarity >= .3 ? 'descrição semelhante' : ''].filter(Boolean), ambiguous: Boolean(exact[1] && Math.abs(exact[0].similarity - exact[1].similarity) < .1) })
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence)
}

export function detectMovementAnomalies(movements: BankMovement[]): MovementAnomaly[] {
  const pending = movements.filter(item => item.status === 'pending')
  if (!pending.length) return []
  const amounts = pending.map(item => Math.abs(item.amount)).sort((a, b) => a - b)
  const median = amounts[Math.floor(amounts.length / 2)] || 0
  const seen = new Map<string, BankMovement>()
  const anomalies: MovementAnomaly[] = []
  for (const item of pending) {
    const duplicateKey = `${item.source}|${item.date}|${Math.abs(item.amount).toFixed(2)}|${normalizeForMatch(item.description)}`
    if (seen.has(duplicateKey)) anomalies.push({ movementId: item.id, severity: 'critical', message: 'Possível movimento duplicado' })
    else seen.set(duplicateKey, item)
    if (median > 0 && Math.abs(item.amount) > median * 8) anomalies.push({ movementId: item.id, severity: 'warning', message: `Valor muito acima da mediana (${median.toFixed(2)} €)` })
    if (!item.description.trim() || item.description.trim().length < 4) anomalies.push({ movementId: item.id, severity: 'warning', message: 'Descrição insuficiente' })
  }
  return anomalies
}
