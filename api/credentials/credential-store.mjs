import { join } from 'node:path'
import { readEncryptedJson, writeEncryptedJson } from '../lib/crypto-store.mjs'

export function credentialPath(runtimeDirectory, companyCode) {
  return join(runtimeDirectory, 'credentials', `${companyCode}.json.enc`)
}

export async function saveFinancasCredentials(runtimeDirectory, companyCode, user, password) {
  await writeEncryptedJson(
    credentialPath(runtimeDirectory, companyCode),
    { user, password, updatedAt: new Date().toISOString() },
    process.env.PRIMAVERA_API_CRED_KEY,
  )
}

export async function readFinancasCredentials(runtimeDirectory, companyCode) {
  return readEncryptedJson(credentialPath(runtimeDirectory, companyCode), process.env.PRIMAVERA_API_CRED_KEY)
}
