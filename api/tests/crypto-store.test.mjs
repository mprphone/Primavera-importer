import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readEncryptedJson, writeEncryptedJson } from '../lib/crypto-store.mjs'

test('guarda credenciais cifradas e permite recuperá-las', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'primavera-gateway-'))
  const file = join(directory, 'credentials.enc')
  const value = { user: '501563245', password: 'segredo' }
  const key = 'uma-chave-de-testes-com-mais-de-24-caracteres'

  await writeEncryptedJson(file, value, key)

  assert.deepEqual(await readEncryptedJson(file, key), value)
  assert.equal((await readFile(file, 'utf8')).includes('segredo'), false)
})
