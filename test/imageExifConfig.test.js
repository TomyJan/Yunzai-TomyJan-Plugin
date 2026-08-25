import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const defaultConfig = JSON.parse(
  fs.readFileSync(
    new URL('../data/system/default_config.json', import.meta.url),
    'utf8',
  ),
)

test('keeps automatic EXIF location replies disabled with no chat scope fields', () => {
  assert.deepEqual(defaultConfig.imageExif, {
    enable: false,
    provider: 'nominatim',
    honorific: '先生',
    timeoutMs: 10000,
    maxFileSize: 20971520,
    geocodingEndpoint: 'https://nominatim.openstreetmap.org/reverse',
    amap: { apiKeys: [] },
    proxy: { enable: false },
  })
})
