export type ModelVarType = 'text' | 'number'

export type ModelVar = {
  key: string
  label: string
  type: ModelVarType
  defaultValue?: string
}

export type PostingModel = {
  id: string
  name: string
  description: string
  // Templates for the 2 lines
  creditTemplate: string
  debitTemplate: string
  // Which side is which (for UI only)
  creditAccountFixed?: string
  debitAccountFixed?: string
  // Optional model variables (empty for fixed models)
  variables: ModelVar[]
}
