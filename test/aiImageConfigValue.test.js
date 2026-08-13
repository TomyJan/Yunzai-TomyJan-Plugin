import assert from 'node:assert/strict'
import test from 'node:test'

import {
  migrateAiImageConfig,
  parseApiKeys,
  parseSightengineCredentials,
  serializeAiImageCredentialFields,
} from '../model/aiImageConfig.js'

test('removes legacy single credentials and provider proxy settings', () => {
  const config = {
    eduAuth: { apiKey: 'keep-edu-key' },
    aiImage: {
      proxy: { enable: true },
      openai: {
        apiKey: 'legacy-openai',
        apiKeys: ['openai-key'],
        proxy: { enable: true, url: 'http://legacy' },
      },
      hive: { apiKey: 'legacy-hive', apiKeys: ['hive-key'] },
      sightengine: {
        apiUser: 'legacy-user',
        apiSecret: 'legacy-secret',
        credentials: [{ apiUser: 'user', apiSecret: 'secret' }],
        proxy: { enable: true },
      },
    },
  }

  const migrated = migrateAiImageConfig(config)

  assert.equal(migrated.eduAuth.apiKey, 'keep-edu-key')
  assert.equal(migrated.aiImage.proxy.enable, true)
  assert.equal(migrated.aiImage.openai.apiKey, undefined)
  assert.equal(migrated.aiImage.openai.proxy, undefined)
  assert.equal(migrated.aiImage.hive.apiKey, undefined)
  assert.equal(migrated.aiImage.sightengine.apiUser, undefined)
  assert.equal(migrated.aiImage.sightengine.apiSecret, undefined)
  assert.equal(migrated.aiImage.sightengine.proxy, undefined)
})

test('moves compatible legacy credentials but discards Hive V2 keys', () => {
  const migrated = migrateAiImageConfig({
    aiImage: {
      openai: { apiKey: 'openai-key' },
      hive: { apiKey: 'hive-key' },
      sightengine: { apiUser: 'user', apiSecret: 'secret' },
    },
  })

  assert.deepEqual(migrated.aiImage.openai.apiKeys, ['openai-key'])
  assert.deepEqual(migrated.aiImage.hive.apiKeys, [])
  assert.deepEqual(migrated.aiImage.sightengine.credentials, [
    { apiUser: 'user', apiSecret: 'secret' },
  ])
})

test('normalizes credential arrays previously saved as JSON strings', () => {
  const migrated = migrateAiImageConfig({
    aiImage: {
      openai: { apiKeys: '["openai-key"]' },
      hive: { apiKeys: '["hive-key"]' },
      sightengine: {
        credentials: '[{"apiUser":"user","apiSecret":"secret"}]',
      },
    },
  })

  assert.deepEqual(migrated.aiImage.openai.apiKeys, ['openai-key'])
  assert.deepEqual(migrated.aiImage.hive.apiKeys, ['hive-key'])
  assert.deepEqual(migrated.aiImage.sightengine.credentials, [
    { apiUser: 'user', apiSecret: 'secret' },
  ])
})

test('keeps configured Hive V3 Secret Keys while deleting a Hive V2 key', () => {
  const migrated = migrateAiImageConfig({
    aiImage: {
      hive: {
        apiKey: 'legacy-v2-key',
        apiKeys: ['v3-secret-key'],
      },
    },
  })

  assert.deepEqual(migrated.aiImage.hive.apiKeys, ['v3-secret-key'])
  assert.equal(migrated.aiImage.hive.apiKey, undefined)
})

test('parses API key arrays from Guoba JSON fields', () => {
  assert.deepEqual(parseApiKeys('[" first ", "", "second"]'), [
    'first',
    'second',
  ])
  assert.deepEqual(parseApiKeys(['first', ' second ']), ['first', 'second'])
})

test('parses complete Sightengine credential pairs', () => {
  assert.deepEqual(
    parseSightengineCredentials(
      '[{"apiUser":" user ","apiSecret":" secret "},{"apiUser":"bad"}]',
    ),
    [{ apiUser: 'user', apiSecret: 'secret' }],
  )
})

test('rejects malformed JSON instead of saving invalid credentials', () => {
  assert.throws(() => parseApiKeys('[broken'), /合法的 JSON 数组/)
  assert.throws(() => parseApiKeys('{}'), /必须是 JSON 数组/)
})

test('keeps API key arrays native and serializes Sightengine entries for Guoba', () => {
  const config = {
    aiImage: {
      openai: { apiKeys: ['openai-key'] },
      hive: { apiKeys: ['hive-key'] },
      sightengine: {
        credentials: [{ apiUser: 'user', apiSecret: 'secret' }],
      },
    },
  }

  const displayed = serializeAiImageCredentialFields(config)

  assert.deepEqual(displayed.aiImage.openai.apiKeys, ['openai-key'])
  assert.deepEqual(displayed.aiImage.hive.apiKeys, ['hive-key'])
  assert.deepEqual(displayed.aiImage.sightengine.credentials, [
    '{"apiUser":"user","apiSecret":"secret"}',
  ])
  assert.deepEqual(config.aiImage.openai.apiKeys, ['openai-key'])
})

test('parses Sightengine credential arrays submitted by Guoba multiple select', () => {
  assert.deepEqual(
    parseSightengineCredentials([
      '{"apiUser":" first ","apiSecret":" secret-1 "}',
      '{"apiUser":"second","apiSecret":"secret-2"}',
    ]),
    [
      { apiUser: 'first', apiSecret: 'secret-1' },
      { apiUser: 'second', apiSecret: 'secret-2' },
    ],
  )
})
