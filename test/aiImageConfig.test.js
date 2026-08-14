import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const defaultConfig = JSON.parse(
  fs.readFileSync(
    new URL('../data/system/default_config.json', import.meta.url),
  ),
)
const packageJson = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url)),
)
const guobaSource = fs.readFileSync(
  new URL('../guoba.support.js', import.meta.url),
  'utf8',
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
  assert.match(guobaSource, /field: 'aiImage\.proxy\.enable'/)
  assert.match(guobaSource, /field: 'aiImage\.openai\.apiKeys'/)
  assert.match(guobaSource, /field: 'aiImage\.hive\.apiKeys'/)
  assert.match(guobaSource, /field: 'aiImage\.sightengine\.credentials'/)
  assert.doesNotMatch(guobaSource, /field: 'aiImage\.openai\.apiKey'/)
  assert.doesNotMatch(guobaSource, /field: 'aiImage\.hive\.apiKey'/)
  assert.doesNotMatch(guobaSource, /field: 'aiImage\.sightengine\.apiUser'/)
  assert.doesNotMatch(guobaSource, /field: 'aiImage\.[^']+\.proxy\./)
  assert.doesNotMatch(
    guobaSource,
    /tjLogger\.[a-z]+\([^\n]*JSON\.stringify\(configJson\)/,
  )
})

test('uses Guoba free-form tag inputs for AI credential arrays', () => {
  for (const field of [
    'aiImage.openai.apiKeys',
    'aiImage.hive.apiKeys',
    'aiImage.sightengine.credentials',
  ]) {
    const fieldIndex = guobaSource.indexOf(`field: '${field}'`)
    assert.notEqual(fieldIndex, -1)
    const schemaSource = guobaSource.slice(fieldIndex, fieldIndex + 700)
    assert.match(schemaSource, /component: 'GTags'/)
    assert.match(schemaSource, /allowAdd: true/)
    assert.match(schemaSource, /allowDel: true/)
    assert.doesNotMatch(schemaSource, /component: 'Select'/)
    assert.doesNotMatch(schemaSource, /mode: '(?:multiple|tags)'/)
    assert.doesNotMatch(schemaSource, /options: \[\]/)
  }
})

test('describes Hive credentials as V3 Secret Keys only', () => {
  const fieldIndex = guobaSource.indexOf("field: 'aiImage.hive.apiKeys'")
  assert.notEqual(fieldIndex, -1)
  const schemaSource = guobaSource.slice(fieldIndex, fieldIndex + 700)

  assert.match(schemaSource, /Hive V3 Secret Keys/)
  assert.match(schemaSource, /只填写创建 V3 API Key 时显示的 Secret Key/)
  assert.doesNotMatch(schemaSource, /Access Key|AK\s*\+/i)
})

test('contains no Hive V2 endpoint or Token authorization', () => {
  const providerSource = fs.readFileSync(
    new URL('../model/aiImageProviders.js', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(providerSource, /thehive\.ai\/api\/v2\/task/i)
  assert.doesNotMatch(providerSource, /Authorization:\s*`Token/i)
})
