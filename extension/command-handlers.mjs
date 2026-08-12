export async function handleCommand(provider, rpc, payload) {
  if (rpc === 'health') {
    return provider.health(payload.companyCode, payload)
  }

  if (rpc === 'syncMasterData') {
    const data = await provider.syncMasterData(payload.companyCode, payload)
    return { success: true, message: 'Dados do ERP Evolution sincronizados.', data }
  }

  if (rpc === 'syncEntities') {
    if (!['customer', 'supplier'].includes(payload.entityType)) {
      return { success: false, message: 'Tipo de entidade inválido.' }
    }
    const data = await provider.syncEntities(payload.companyCode, payload)
    return { success: true, message: 'Página de entidades sincronizada.', data }
  }

  if (rpc === 'createPostings') {
    return provider.createPostings(payload.companyCode, payload)
  }

  if (rpc === 'syncLedger') {
    const data = await provider.syncLedger(payload.companyCode, payload)
    return { success: true, message: `${data.movements?.length ?? 0} movimentos lidos.`, data }
  }

  if (rpc === 'syncPurchases') {
    const data = await provider.syncPurchases(payload.companyCode, payload)
    return { success: true, message: `${data.movements?.length ?? 0} movimentos contabilísticos lidos para confirmar compras.`, data }
  }

  if (rpc === 'syncIntrastatSales') {
    const data = await provider.syncIntrastatSales(payload.companyCode, payload)
    return {
      success: true,
      message: `${data.lines?.length ?? 0} linhas de vendas lidas para o Intrastat.`,
      data,
    }
  }

  return { success: false, message: `RPC desconhecido: ${rpc}` }
}
