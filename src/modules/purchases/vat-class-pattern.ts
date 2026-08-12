import { PrimaveraMasterData, VatRate } from '../../core/master-data'

// A "Classe de IVA" de uma conta no ERP Evolution é um template com partes em aberto (ex: "123???11")
// que representam taxa/mercado/região a escolher caso a caso — não um código fixo. Por isso não dá
// para resolver o Código IVA 100% automaticamente a partir daí; em vez disso usamos o template para
// filtrar a lista de escolha manual aos códigos do Plano de IVA compatíveis com aquela conta de gasto.
export function matchesVatClassPattern(pattern: string, code: string): boolean {
  if (pattern.length !== code.length) return false
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '?' && pattern[i] !== code[i]) return false
  }
  return true
}

export function vatCodeOptionsForExpenseAccount(masterData: PrimaveraMasterData, expenseAccount: string): VatRate[] {
  const vatClass = masterData.accounts.find(account => account.code === expenseAccount)?.vatClass
  const filtered = vatClass ? masterData.vatRates.filter(rate => matchesVatClassPattern(vatClass, rate.code)) : []
  // Inclui sempre códigos sem conta associada (IVA não dedutível, ex: Art.21º) — ainda assim têm
  // de poder ser escolhidos para constarem na linha do lançamento (reporte do Anexo L).
  return filtered.length ? filtered : masterData.vatRates
}
