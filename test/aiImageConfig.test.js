import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { getGuobaSchemas } from '../model/guobaSchemas.js'

const defaultConfig = JSON.parse(
  fs.readFileSync(
    new URL('../data/system/default_config.json', import.meta.url),
  ),
)
const packageJson = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url)),
)
const schemas = getGuobaSchemas()
const schemaByField = new Map(
  schemas
    .filter((schema) => schema.field)
    .map((schema) => [schema.field, schema]),
)

test('requires Node.js 22 and enables local C2PA support', () => {
  assert.equal(packageJson.engines.node, '>=22.0.0')
  assert.equal(
    typeof packageJson.dependencies['@contentauth/c2pa-node'],
    'string',
  )
})

test('defines one AI image proxy switch and no provider proxy settings', () => {
  const aiImage = defaultConfig.aiImage

  assert.equal(aiImage?.proxy?.enable, false)
  for (const provider of ['openai', 'hive', 'sightengine']) {
    assert.equal(aiImage?.[provider]?.proxy, undefined)
  }
})

test('uses only arrays for AI image API credentials', () => {
  const aiImage = defaultConfig.aiImage

  assert.deepEqual(aiImage?.openai?.apiKeys, [])
  assert.equal(aiImage?.openai?.apiKey, undefined)
  assert.deepEqual(aiImage?.hive?.apiKeys, [])
  assert.equal(aiImage?.hive?.apiKey, undefined)
  assert.deepEqual(aiImage?.sightengine?.credentials, [])
  assert.equal(aiImage?.sightengine?.apiUser, undefined)
  assert.equal(aiImage?.sightengine?.apiSecret, undefined)
})

test('keeps conservative AI image defaults', () => {
  const aiImage = defaultConfig.aiImage

  assert.equal(aiImage?.enable, false)
  assert.equal(aiImage?.timeoutMs, 15000)
  assert.equal(aiImage?.maxFileSize, 50 * 1024 * 1024)
  assert.equal(aiImage?.c2pa?.enable, true)
  assert.equal(aiImage?.openai?.enable, true)
  assert.equal(aiImage?.hive?.enable, true)
  assert.equal(aiImage?.sightengine?.enable, false)
})

test('exposes only the new AI credential and proxy fields in Guoba', () => {
  for (const field of [
    'aiImage.proxy.enable',
    'aiImage.openai.apiKeys',
    'aiImage.hive.apiKeys',
    'aiImage.sightengine.credentials',
  ]) {
    assert.equal(schemaByField.has(field), true, field)
  }
  for (const field of [
    'aiImage.openai.apiKey',
    'aiImage.hive.apiKey',
    'aiImage.sightengine.apiUser',
  ]) {
    assert.equal(schemaByField.has(field), false, field)
  }
  assert.deepEqual(
    [...schemaByField.keys()].filter((field) =>
      /^aiImage\.[^.]+\.proxy\./.test(field),
    ),
    [],
  )
})

test('uses Guoba free-form tag inputs for AI credential arrays', () => {
  for (const field of [
    'aiImage.openai.apiKeys',
    'aiImage.hive.apiKeys',
    'aiImage.sightengine.credentials',
  ]) {
    const schema = schemaByField.get(field)
    assert.equal(schema?.component, 'GTags')
    assert.equal(schema?.componentProps?.allowAdd, true)
    assert.equal(schema?.componentProps?.allowDel, true)
    assert.equal(schema?.componentProps?.mode, undefined)
    assert.equal(schema?.componentProps?.options, undefined)
  }
})

test('describes Hive credentials as V3 Secret Keys only', () => {
  const schema = schemaByField.get('aiImage.hive.apiKeys')
  assert.equal(schema.label, 'Hive V3 Secret Keys')
  assert.match(schema.helpMessage, /只填写创建 V3 API Key 时显示的 Secret Key/)
  assert.doesNotMatch(
    `${schema.label} ${schema.helpMessage} ${schema.bottomHelpMessage}`,
    /Access Key|AK\s*\+/i,
  )
})
