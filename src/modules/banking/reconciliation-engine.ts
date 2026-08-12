import { BankMovement, ReconciliationMatch } from './types'

function dayDifference(a: string, b: string) {
  return Math.abs(new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86_400_000
}

// O extrato bancário e o razão da ERP Evolution rotulam o mesmo movimento real com naturezas (D/C)
// que dependem da terminologia de cada lado e do tipo de documento (ex: uma fatura de comissões
// pode aparecer de formas diferentes consoante retenções/IVA associados). Não há uma convenção
// universal de sinal/natureza fiável entre as duas fontes, por isso a comparação só usa o valor
// absoluto — quem decide se a correspondência é válida é o próprio utilizador, ao selecionar.
function sameAmount(a: BankMovement, b: BankMovement) {
  return Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) < 0.005
}

export function findExactMatches(movements: BankMovement[], toleranceDays: number) {
  const banks = movements.filter(item => item.source === 'bank' && item.status === 'pending')
  const accounting = movements.filter(item => item.source === 'accounting' && item.status === 'pending')
  const usedAccounting = new Set<string>()
  const pairs: Array<{ bank: BankMovement; accounting: BankMovement }> = []

  for (const bank of banks) {
    const candidates = accounting.filter(item =>
      !usedAccounting.has(item.id) &&
      sameAmount(item, bank) &&
      dayDifference(item.date, bank.date) <= toleranceDays
    )
    // Mais do que um candidato com o mesmo valor/período é ambíguo. Nunca é reconciliado
    // automaticamente; fica visível nas sugestões inteligentes para decisão humana.
    const match = candidates.length === 1 ? candidates[0] : undefined
    if (!match) continue
    usedAccounting.add(match.id)
    pairs.push({ bank, accounting: match })
  }
  return pairs
}

export function applyMatch(
  movements: BankMovement[],
  bankIds: string[],
  accountingIds: string[],
  reason: string,
) {
  const id = `match-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const selected = new Set([...bankIds, ...accountingIds])
  const match: ReconciliationMatch = { id, bankIds, accountingIds, createdAt: new Date().toISOString(), reason }
  return {
    match,
    movements: movements.map(item => selected.has(item.id) ? { ...item, status: 'reconciled' as const, matchId: id } : item),
  }
}

export function undoMatch(movements: BankMovement[], matchId: string) {
  return movements.map(item => item.matchId === matchId
    ? { ...item, status: 'pending' as const, matchId: undefined }
    : item)
}

export function selectionDifference(movements: BankMovement[], bankIds: string[], accountingIds: string[]) {
  const banks = movements.filter(item => bankIds.includes(item.id))
  const accounting = movements.filter(item => accountingIds.includes(item.id))
  const bankTotal = banks.reduce((sum, item) => sum + Math.abs(item.amount), 0)
  const accountingTotal = accounting.reduce((sum, item) => sum + Math.abs(item.amount), 0)
  return Number((bankTotal - accountingTotal).toFixed(2))
}
