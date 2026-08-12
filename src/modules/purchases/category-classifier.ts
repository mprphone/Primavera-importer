import { normalizeForMatch } from '../../core/utils'

const categoryKeywords: Record<string, string[]> = {
  energia: ['edp', 'galp energia', 'goldenergy', 'endesa', 'iberdrola', 'eletricidade', 'eletrica de', 'energia s', 'energia,'],
  combustivel: ['galp', 'bp ', 'repsol', 'cepsa', 'prio', 'combustive', 'estacao de servico'],
  comunicacoes: ['meo', 'nos comunicacoes', 'vodafone', 'nowo', 'telecomunica'],
  seguros: ['fidelidade', 'allianz', 'tranquilidade', 'ageas', 'generali', 'seguros'],
  agua: ['aguas de', 'saneamento', 'agua e saneamento', 'servico de agua'],
  combustivel_gas: ['galp gas', 'gas natural', 'goldgas'],
  restauracao: ['restaurante', 'cafe ', 'pastelaria', 'churrasqueira', 'snack bar', 'marisqueira'],
  correios: ['ctt ', 'correios'],
  manutencao_auto: ['pneus', 'oficina', 'stand', 'auto pecas', 'reparacao automovel'],
}

export function detectCategory(supplierName: string, description: string): string {
  const text = normalizeForMatch(`${supplierName} ${description}`).toLowerCase()
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => text.includes(keyword))) return category
  }
  return ''
}
