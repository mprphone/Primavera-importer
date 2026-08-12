import { normalizeForMatch } from '../../core/utils'

// Duas chaves de agrupamento: a exata cobre repetições idênticas (ex: comissões fixas mensais),
// o prefixo cobre famílias de descrição com nomes/referências variáveis (ex: "ORDENADO P/ ...").
export function exactDescriptionKey(description: string): string {
  return normalizeForMatch(description)
}

export function prefixDescriptionKey(description: string): string {
  const tokens = normalizeForMatch(description).split(' ').filter(token => token && !/\d/.test(token))
  return tokens.slice(0, 2).join(' ')
}
