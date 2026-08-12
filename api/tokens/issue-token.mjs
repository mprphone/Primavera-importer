import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTokens, saveTokens } from './extension-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const runtimeDirectory = join(here, '..', 'runtime')

const [companyCode, label] = process.argv.slice(2)
if (!companyCode) {
  console.error('Uso: node tokens/issue-token.mjs <CODIGO_EMPRESA> [rotulo]')
  process.exit(1)
}

const tokens = await loadTokens(runtimeDirectory)
const token = randomBytes(32).toString('hex')
tokens[companyCode] = { token, label: label || companyCode }
await saveTokens(runtimeDirectory, tokens)

console.log(`Token emitido para ${companyCode}:`)
console.log(token)
