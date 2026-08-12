import assert from 'node:assert/strict'
import test from 'node:test'
import { getConnection, register, unregister } from '../relay/extension-registry.mjs'

test('mantém a primeira extensão ativa quando outra usa o mesmo token', () => {
  const token = `token-${Date.now()}-${Math.random()}`
  const firstSocket = {}
  const secondSocket = {}

  const first = register(token, firstSocket)
  const duplicate = register(token, secondSocket)

  assert.ok(first)
  assert.equal(duplicate, null)
  assert.equal(getConnection(token)?.socket, firstSocket)

  unregister(token, firstSocket)
  assert.equal(getConnection(token), undefined)
})
