import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  getPurchaseInvoiceDetail,
  listCompanies,
  listPurchaseInvoices,
  validatePurchaseInvoiceManually,
} from './tools/primavera-purchases.mjs'

// Ferramentas do primavera-importer. Novas apps (Gestao_SAFT_MPR_v1, etc.) entram como novos
// ficheiros em tools/ + novas chamadas a server.tool() aqui, com um prefixo próprio no nome
// (ex.: "saft_...") para não colidir com estas.
export function createMcpServer() {
  const server = new McpServer({ name: 'mpr-apps', version: '0.1.0' })

  server.tool(
    'primavera_listar_empresas',
    'Lista as empresas configuradas no primavera-importer, com NIF e localização.',
    {},
    async () => {
      const companies = await listCompanies()
      return { content: [{ type: 'text', text: JSON.stringify(companies, null, 2) }] }
    },
  )

  server.tool(
    'primavera_listar_faturas_compras',
    'Lista faturas de compras de uma empresa do primavera-importer, com o estado da verificação ' +
      'automática no Primavera ("confirmed" = confirmada, "possible" = a rever, "missing" = não ' +
      'confirmada, "por_verificar" = ainda não verificada). Usa primeiro primavera_listar_empresas ' +
      'para saber o id da empresa.',
    {
      empresaId: z.string().describe('Id da empresa (ex.: "jactigas")'),
      estado: z.enum(['confirmed', 'possible', 'missing', 'por_verificar', 'todas']).optional()
        .describe('Filtrar por estado da verificação. Omitir = todas.'),
      mes: z.string().optional().describe('Filtrar por mês, formato AAAA-MM'),
      fornecedor: z.string().optional().describe('Filtrar por nome (parcial) ou NIF exato do fornecedor'),
    },
    async ({ empresaId, estado, mes, fornecedor }) => {
      const invoices = await listPurchaseInvoices({ empresaId, estado, mes, fornecedor })
      return { content: [{ type: 'text', text: JSON.stringify(invoices, null, 2) }] }
    },
  )

  server.tool(
    'primavera_obter_detalhe_fatura',
    'Obtém o detalhe completo de uma fatura de compra, incluindo o lançamento contabilístico ' +
      'encontrado no Primavera (se houver) e o histórico de validação manual (se aplicável).',
    {
      empresaId: z.string().describe('Id da empresa'),
      faturaId: z.string().describe('Id interno da fatura ou o número do documento (ex.: "FAC 26/18")'),
    },
    async ({ empresaId, faturaId }) => {
      const invoice = await getPurchaseInvoiceDetail({ empresaId, faturaId })
      if (!invoice) return { content: [{ type: 'text', text: 'Fatura não encontrada.' }], isError: true }
      return { content: [{ type: 'text', text: JSON.stringify(invoice, null, 2) }] }
    },
  )

  server.tool(
    'primavera_validar_fatura_manualmente',
    'Confirma manualmente uma fatura de compra que ficou "a rever" ou "não confirmada" na ' +
      'verificação automática. Só usar depois de confirmar (com o utilizador ou outra fonte) que ' +
      'a fatura está mesmo lançada corretamente no Primavera — fica registado como validação manual, ' +
      'com a justificação, para auditoria.',
    {
      empresaId: z.string().describe('Id da empresa'),
      faturaId: z.string().describe('Id interno da fatura ou o número do documento'),
      justificacao: z.string().describe('Motivo da validação manual'),
    },
    async ({ empresaId, faturaId, justificacao }) => {
      const updated = await validatePurchaseInvoiceManually({ empresaId, faturaId, justificacao })
      return { content: [{ type: 'text', text: `Fatura ${updated.documentNo} validada manualmente.` }] }
    },
  )

  return server
}
