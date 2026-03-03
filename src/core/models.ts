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

export const BuiltInModels: PostingModel[] = [
  {
    id: 'coop-receipts-1201-1290',
    name: 'Recibos Coop (1201 D / 1290 C)',
    description: 'Gera 2 linhas por movimento: 1201 a Débito e 1290 a Crédito.',
    creditTemplate: "SNNFP31121290                32       120201321  -1        COB PAG SERV -21287                                          2564.10C                                           1                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00",
    debitTemplate: "SNNFP31121201                32       120201321  -1        COB PAG SERV -21287                                          2564.10D                                           2                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00",
    creditAccountFixed: '1290',
    debitAccountFixed: '1201',
    variables: [],
  },
  {
    id: 'santander-payments-221110001-1201',
    name: 'Pagamentos Santander (221110001 D / 1201 C)',
    description: 'Gera 2 linhas por movimento: 221110001 a Débito (Fornecedor) e 1201 a Crédito.',
    creditTemplate: "SNNFP31121201                32       120129321  -1        DEVOLU\ufffd\ufffdO D\ufffdB.DIR-D3548559-631/01                             403.91C                                           1                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00",
    debitTemplate: "SNNFP3112221110001           32       120129321  -1        DEVOLU\ufffd\ufffdO D\ufffdB.DIR-D3548559-631/01                             403.91D                                           2                             N                   2025EUR         1.0000000         1.0000000         1.00000000N             0.00",
    creditAccountFixed: '1201',
    debitAccountFixed: '221110001',
    variables: [],
  },
]
