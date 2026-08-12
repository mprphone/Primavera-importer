/**
 * Adaptador reservado ao SDK/Engine do ERP Evolution v10.
 *
 * Em produção, esta classe deve correr em Windows e chamar um módulo .NET/COM
 * instalado juntamente com o ERP. O contrato público deve manter os métodos
 * health, syncMasterData e createPostings usados pelo servidor.
 */
export class PrimaveraSdkProvider {
  async health() {
    return {
      success: false,
      message: 'O adaptador do SDK ERP Evolution ainda não foi instalado neste gateway.',
    }
  }

  async syncMasterData() {
    throw new Error('O adaptador do SDK ERP Evolution ainda não foi instalado.')
  }

  async syncPurchases() {
    throw new Error('O adaptador do SDK ERP Evolution ainda não foi instalado.')
  }

  async createPostings() {
    throw new Error('O adaptador do SDK ERP Evolution ainda não foi instalado.')
  }
}
