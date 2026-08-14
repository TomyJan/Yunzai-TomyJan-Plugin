import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const defaultConfig = JSON.parse(
  fs.readFileSync(
    new URL('../data/system/default_config.json', import.meta.url),
    'utf8',
  ),
)
const guobaSource = fs
  .readFileSync(new URL('../guoba.support.js', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n')
const jmDownloadSource = fs
  .readFileSync(new URL('../apps/jmDownload.js', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n')

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
    const start = guobaSource.indexOf(`field: '${field}'`)
    assert.notEqual(start, -1)
    assert.match(guobaSource.slice(start, start + 500), /component: 'Switch'/)
  }
})

test('uses editable Guoba tag arrays and documents the jmv cost', () => {
  for (const field of [
    'JMComic.albumIdBlacklist.ids',
    'JMComic.authorNameBlacklist.names',
  ]) {
    const start = guobaSource.indexOf(`field: '${field}'`)
    assert.notEqual(start, -1)
    const fieldSource = guobaSource.slice(start, start + 500)
    assert.match(fieldSource, /component: 'GTags'/)
    assert.match(fieldSource, /allowAdd: true/)
    assert.match(fieldSource, /allowDel: true/)
  }
  assert.match(guobaSource, /额外查询一次本子详情/)
  assert.match(guobaSource, /最多获取前 10 个作者/)
})

test('redacts proxy sync failures and keeps the user reply generic', () => {
  const start = jmDownloadSource.indexOf('syncJmProxyConfig(optionPath')
  const end = jmDownloadSource.indexOf('const authorBlocked', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const proxySyncSource = jmDownloadSource.slice(start, end)

  assert.match(proxySyncSource, /redactJmError\(error\)/)
  assert.match(
    proxySyncSource,
    /同步 JMComic 代理配置失败，请检查 option\.yml/,
  )
  assert.doesNotMatch(proxySyncSource, /\$\{error\.message\}/)
})
