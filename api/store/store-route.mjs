import { join } from 'node:path'
import { readJson, writeJson } from '../lib/json-files.mjs'

export function validStoreKey(value) {
  return typeof value === 'string' && /^[a-z0-9_]{1,60}$/.test(value)
}

function storePath(runtimeDirectory, companyCode, key) {
  return join(runtimeDirectory, 'store', companyCode, `${key}.json`)
}

export async function getStoreValue(runtimeDirectory, companyCode, key) {
  return readJson(storePath(runtimeDirectory, companyCode, key), null)
}

export async function setStoreValue(runtimeDirectory, companyCode, key, data) {
  await writeJson(storePath(runtimeDirectory, companyCode, key), data)
}
