import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { getGuobaSchemas } from '../model/guobaSchemas.js'

const defaultConfig = JSON.parse(
  fs.readFileSync(
    new URL('../data/system/default_config.json', import.meta.url),
    'utf8',
  ),
)
const schemaByField = new Map(
  getGuobaSchemas()
    .filter((schema) => schema.field)
    .map((schema) => [schema.field, schema]),
)

test('defines disabled JMComic blacklists by default', () => {
  assert.deepEqual(defaultConfig.JMComic.albumIdBlacklist, {
    enable: false,
    ids: [],
  })
  assert.deepEqual(defaultConfig.JMComic.authorNameBlacklist, {
    enable: false,
    names: [],
  })
})

test('uses independent Guoba switches for JMComic blacklists', () => {
  for (const field of [
    'JMComic.albumIdBlacklist.enable',
    'JMComic.authorNameBlacklist.enable',
  ]) {
    assert.equal(schemaByField.get(field)?.component, 'Switch')
  }
})

test('uses editable Guoba tag arrays and documents the jmv cost', () => {
  for (const field of [
    'JMComic.albumIdBlacklist.ids',
    'JMComic.authorNameBlacklist.names',
  ]) {
    const schema = schemaByField.get(field)
    assert.equal(schema?.component, 'GTags')
    assert.equal(schema?.componentProps?.allowAdd, true)
    assert.equal(schema?.componentProps?.allowDel, true)
  }
  assert.match(
    schemaByField.get('JMComic.authorNameBlacklist.enable').helpMessage,
    /额外查询一次本子详情/,
  )
  assert.match(
    schemaByField.get('JMComic.authorNameBlacklist.names').bottomHelpMessage,
    /最多获取前 10 个作者/,
  )
})
