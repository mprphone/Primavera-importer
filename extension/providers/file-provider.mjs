import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, writeJson } from '../lib/json-files.mjs'

export class FilePrimaveraProvider {
  constructor({ seedDirectory, runtimeDirectory }) {
    this.seedDirectory = seedDirectory
    this.runtimeDirectory = runtimeDirectory
  }

  async health(companyCode) {
    const file = join(this.seedDirectory, `${companyCode}.json`)
    try {
      await access(file)
      return {
        success: true,
        message: `Gateway ativo. Empresa ${companyCode} disponível no fornecedor local de desenvolvimento.`,
      }
    } catch {
      return {
        success: false,
        message: `Gateway ativo, mas não existem dados para a empresa ${companyCode}.`,
      }
    }
  }

  async syncMasterData(companyCode) {
    const data = await readJson(join(this.seedDirectory, `${companyCode}.json`), null)
    if (!data) throw new Error(`Não existem dados mestres para a empresa ${companyCode}.`)
    return {
      accounts: data.accounts ?? [],
      customers: (data.customers ?? []).map(entity => ({ ...entity, type: 'customer' })),
      suppliers: (data.suppliers ?? []).map(entity => ({ ...entity, type: 'supplier' })),
      vatRates: data.vatRates ?? [],
      syncedAt: new Date().toISOString(),
    }
  }

  async syncLedger() {
    return { movements: [] }
  }

  async syncPurchases() {
    return { movements: [] }
  }

  async createPostings(companyCode, request) {
    const outbox = join(this.runtimeDirectory, 'outbox')
    await mkdir(outbox, { recursive: true })
    const id = `${new Date().toISOString().replaceAll(':', '-')}-${companyCode}`
    await writeJson(join(outbox, `${id}.json`), {
      id,
      status: 'pending-primavera-adapter',
      receivedAt: new Date().toISOString(),
      companyCode,
      request,
    })
    return {
      success: true,
      message: `Lançamento ${id} recebido pelo gateway e colocado na fila local.`,
    }
  }
}
