import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { withProxy } from '../model/proxy.js'

const defaultConfig = JSON.parse(
  fs.readFileSync(
    new URL('../data/system/default_config.json', import.meta.url),
  ),
)

test('defines one global proxy address and per-feature switches', () => {
  assert.equal(defaultConfig.proxy?.url, '')
  assert.equal(defaultConfig.proxy?.autoUpdate, false)
  assert.equal(defaultConfig.proxy?.randomBackground, false)
  assert.equal(defaultConfig.JMComic?.proxy?.enable, false)
  assert.equal(defaultConfig.vvShuo?.proxy?.enable, false)
  assert.equal(defaultConfig.eduAuth?.proxy?.enable, false)
})

test('uses the global proxy address only when a feature enables it', () => {
  const created = []
  const proxyAgentFactory = (url) => {
    created.push(url)
    return { proxyUrl: url }
  }
  const pluginConfig = { proxy: { url: 'http://127.0.0.1:7890' } }

  const proxied = withProxy({ method: 'GET' }, pluginConfig, true, {
    proxyAgentFactory,
  })
  const direct = withProxy({ method: 'GET' }, pluginConfig, false, {
    proxyAgentFactory,
  })

  assert.deepEqual(proxied.dispatcher, { proxyUrl: pluginConfig.proxy.url })
  assert.equal(direct.dispatcher, undefined)
  assert.deepEqual(created, [pluginConfig.proxy.url])
})

test('keeps requests direct when the global proxy address is empty', () => {
  let factoryCalled = false
  const request = withProxy({ method: 'GET' }, { proxy: { url: '' } }, true, {
    proxyAgentFactory: () => {
      factoryCalled = true
    },
  })

  assert.equal(request.dispatcher, undefined)
  assert.equal(factoryCalled, false)
})
