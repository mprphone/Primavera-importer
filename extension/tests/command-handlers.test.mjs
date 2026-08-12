import assert from 'node:assert/strict'
import test from 'node:test'
import { handleCommand } from '../command-handlers.mjs'

test('encaminha syncLedger para o fornecedor local', async () => {
  const provider = {
    async syncLedger(companyCode, payload) {
      assert.equal(companyCode, 'MPR')
      assert.equal(payload.account, '1201')
      return { movements: [{ reference: 'DOC-1' }] }
    },
  }

  const result = await handleCommand(provider, 'syncLedger', {
    companyCode: 'MPR',
    account: '1201',
  })

  assert.equal(result.success, true)
  assert.equal(result.message, '1 movimentos lidos.')
  assert.equal(result.data.movements[0].reference, 'DOC-1')
})

test('encaminha a consulta global de compras sem depender da conta configurada', async () => {
  const provider = {
    async syncPurchases(companyCode, payload) {
      assert.equal(companyCode, 'HELBOR')
      assert.equal(payload.dateFrom, '2026-01-01')
      return { movements: [{ account: '221110001', reference: 'FT/1' }] }
    },
  }

  const result = await handleCommand(provider, 'syncPurchases', {
    companyCode: 'HELBOR',
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
  })

  assert.equal(result.success, true)
  assert.equal(result.message, '1 movimentos contabilísticos lidos para confirmar compras.')
  assert.equal(result.data.movements[0].account, '221110001')
})

test('encaminha as vendas Intrastat para o SQL local', async () => {
  const provider = {
    async syncIntrastatSales(companyCode, payload) {
      assert.equal(companyCode, 'MPR')
      assert.equal(payload.dateFrom, '2026-06-01')
      assert.deepEqual(payload.documentTypes, ['FA', 'NC'])
      return { lines: [{ articleCode: 'T001', netValue: 120.5 }] }
    },
  }

  const result = await handleCommand(provider, 'syncIntrastatSales', {
    companyCode: 'MPR',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    documentTypes: ['FA', 'NC'],
  })

  assert.equal(result.success, true)
  assert.equal(result.message, '1 linhas de vendas lidas para o Intrastat.')
  assert.equal(result.data.lines[0].articleCode, 'T001')
})
