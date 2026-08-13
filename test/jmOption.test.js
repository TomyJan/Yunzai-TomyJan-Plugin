import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { parse } from 'yaml'

import { syncJmProxyConfig } from '../model/jmOption.js'

const source = `download:
  image:
    suffix: .jpg
client:
  domain:
    - 18comic.vip
plugins:
  after_init:
    - plugin: login
      kwargs:
        username: user
`

function withTempOption(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-option-'))
  const optionPath = path.join(directory, 'option.yml')
  fs.writeFileSync(optionPath, source)
  try {
    return run(optionPath)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('adds the global proxy without losing custom JMComic options', () => {
  withTempOption((optionPath) => {
    const changed = syncJmProxyConfig(optionPath, {
      enable: true,
      url: 'http://10.1.1.86:7890',
    })
    const parsed = parse(fs.readFileSync(optionPath, 'utf8'))

    assert.equal(changed, true)
    assert.equal(
      parsed.client.postman.meta_data.proxies,
      'http://10.1.1.86:7890',
    )
    assert.deepEqual(parsed.client.domain, ['18comic.vip'])
    assert.equal(parsed.plugins.after_init[0].kwargs.username, 'user')
  })
})

test('removes only the managed proxy field when JMComic proxy is disabled', () => {
  withTempOption((optionPath) => {
    syncJmProxyConfig(optionPath, {
      enable: true,
      url: 'http://10.1.1.86:7890',
    })
    const changed = syncJmProxyConfig(optionPath, { enable: false, url: '' })
    const parsed = parse(fs.readFileSync(optionPath, 'utf8'))

    assert.equal(changed, true)
    assert.equal(parsed.client.postman?.meta_data?.proxies, undefined)
    assert.deepEqual(parsed.client.domain, ['18comic.vip'])
    assert.equal(parsed.plugins.after_init[0].plugin, 'login')
  })
})

test('does not rewrite an unchanged JMComic proxy configuration', () => {
  withTempOption((optionPath) => {
    syncJmProxyConfig(optionPath, {
      enable: true,
      url: 'http://10.1.1.86:7890',
    })
    const before = fs.readFileSync(optionPath, 'utf8')
    const changed = syncJmProxyConfig(optionPath, {
      enable: true,
      url: 'http://10.1.1.86:7890',
    })

    assert.equal(changed, false)
    assert.equal(fs.readFileSync(optionPath, 'utf8'), before)
  })
})
