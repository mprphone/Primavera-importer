import { normalizeForMatch } from './utils'

export type RuleDomain = 'purchase' | 'posting' | 'reconciliation'

export type SmartRule = {
  id: string
  domain: RuleDomain
  signature: string
  outcome: Record<string, string>
  confirmations: number
  corrections: number
  lastUsedAt: string
}

export type SmartSuggestion = {
  outcome: Record<string, string>
  confidence: number
  evidence: string
}

// v2 começa com histórico limpo: a versão anterior aprendia durante a digitação e podia contar
// cada tecla como uma confirmação independente.
const key = (clientId: string) => `primavera_smart_rules_v2_${clientId}`

export function ruleSignature(value: string) {
  return normalizeForMatch(value).split(' ').filter(token => token.length > 2 && !/^\d+$/.test(token)).slice(0, 6).join(' ')
}

export function loadSmartRules(clientId: string): SmartRule[] {
  try {
    return JSON.parse(localStorage.getItem(key(clientId)) ?? '[]') as SmartRule[]
  } catch {
    return []
  }
}

export function learnSmartRule(
  clientId: string,
  domain: RuleDomain,
  source: string,
  outcome: Record<string, string>,
) {
  const signature = ruleSignature(source)
  if (!signature || !Object.values(outcome).some(Boolean)) return
  const rules = loadSmartRules(clientId)
  const id = `${domain}:${signature}`
  const existing = rules.find(rule => rule.id === id)
  const sameOutcome = existing && JSON.stringify(existing.outcome) === JSON.stringify(outcome)
  const next: SmartRule = {
    id, domain, signature, outcome,
    confirmations: existing ? existing.confirmations + (sameOutcome ? 1 : 0) : 1,
    corrections: (existing?.corrections ?? 0) + (existing && !sameOutcome ? 1 : 0),
    lastUsedAt: new Date().toISOString(),
  }
  localStorage.setItem(key(clientId), JSON.stringify([...rules.filter(rule => rule.id !== id), next]))
}

export function seedSmartRule(clientId: string, domain: RuleDomain, source: string, outcome: Record<string, string>) {
  const signature = ruleSignature(source)
  if (!signature || !Object.values(outcome).some(Boolean)) return
  const rules = loadSmartRules(clientId)
  const id = `${domain}:${signature}`
  if (rules.some(rule => rule.id === id)) return
  const rule: SmartRule = { id, domain, signature, outcome, confirmations: 1, corrections: 0, lastUsedAt: new Date().toISOString() }
  localStorage.setItem(key(clientId), JSON.stringify([...rules, rule]))
}

export function suggestSmartRule(clientId: string, domain: RuleDomain, source: string): SmartSuggestion | null {
  const signature = ruleSignature(source)
  const candidates = loadSmartRules(clientId).filter(rule => rule.domain === domain)
  let best: { rule: SmartRule; overlap: number } | null = null
  const tokens = new Set(signature.split(' '))
  for (const rule of candidates) {
    const ruleTokens = rule.signature.split(' ')
    const overlap = ruleTokens.filter(token => tokens.has(token)).length / Math.max(ruleTokens.length, tokens.size, 1)
    if (!best || overlap > best.overlap) best = { rule, overlap }
  }
  if (!best || best.overlap < 0.34) return null
  const observations = best.rule.confirmations + best.rule.corrections
  const history = best.rule.confirmations / Math.max(observations, 1)
  const sampleReliability = Math.min(1, observations / 3)
  const confidence = Math.round(Math.min(98, (best.overlap * 0.55 + history * 0.20 + sampleReliability * 0.25) * 100))
  return {
    outcome: best.rule.outcome,
    confidence,
    evidence: best.rule.corrections
      ? `${best.rule.confirmations} confirmações e ${best.rule.corrections} correções anteriores`
      : `modelo confirmado em ${best.rule.confirmations} ${best.rule.confirmations === 1 ? 'operação anterior' : 'operações anteriores'}`,
  }
}
