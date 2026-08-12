// O ERP Evolution rejeita lançamentos numa conta/código que tenha subcontas mais específicas (a conta
// "pai" não é de movimento direto) — descobrimos isto só ao tentar importar. Como o erro só
// aparece no ERP Evolution, avisamos aqui antes de exportar: se existe algum código que comece pelo
// escolhido e seja mais longo, é provável que o escolhido seja só agregador.
export function findSubcodes(code: string, allCodes: string[]): string[] {
  if (!code.trim()) return []
  return allCodes.filter(other => other !== code && other.startsWith(code))
}
