import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const guobaSource = fs
  .readFileSync(new URL('../guoba.support.js', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n')

const cardLabels = [
  '日志设置',
  '代理设置',
  'JMComic 功能设置',
  'VV 说设置',
  'AI 图片识别设置',
  'EDU 认证设置',
  'HTTP 服务器设置',
  '随机背景图设置',
  '其他设置',
]

const expectedCardFields = {
  日志设置: ['logger.logLevel', 'logger.saveToFile'],
  代理设置: ['proxy.url', 'proxy.autoUpdate'],
  'JMComic 功能设置': [
    'JMComic.enable',
    'JMComic.proxy.enable',
    'JMComic.albumIdBlacklist.enable',
    'JMComic.albumIdBlacklist.ids',
    'JMComic.authorNameBlacklist.enable',
    'JMComic.authorNameBlacklist.names',
    'JMComic.pdfPassword',
    'JMComic.sendPdfPassword',
    'JMComic.sendFilePolicy',
    'JMComic.archiveDownloadedImg',
    'JMComic.archiveConvertedPdf',
  ],
  'VV 说设置': ['vvShuo.enable', 'vvShuo.proxy.enable'],
  'AI 图片识别设置': [
    'aiImage.enable',
    'aiImage.proxy.enable',
    'aiImage.timeoutMs',
    'aiImage.maxFileSize',
    'aiImage.c2pa.enable',
    'aiImage.openai.enable',
    'aiImage.openai.apiKeys',
    'aiImage.hive.enable',
    'aiImage.hive.apiKeys',
    'aiImage.sightengine.enable',
    'aiImage.sightengine.credentials',
  ],
  'EDU 认证设置': [
    'eduAuth.enable',
    'eduAuth.proxy.enable',
    'eduAuth.apiBaseUrl',
    'eduAuth.apiKey',
    'eduAuth.userGroup',
    'eduAuth.adminGroup',
  ],
  'HTTP 服务器设置': [
    'httpServer.enable',
    'httpServer.listenPort',
    'httpServer.accessUrl',
  ],
  随机背景图设置: ['useRandomBgInCard', 'proxy.randomBackground'],
  其他设置: ['attemptSendNonFriend', 'botQQ'],
}

function getCardSource(label) {
  const start = guobaSource.indexOf(
    `component: 'SOFT_GROUP_BEGIN',\n          label: '${label}'`,
  )
  assert.notEqual(start, -1, `缺少锅巴配置卡片：${label}`)
  const nextStarts = cardLabels
    .map((nextLabel) =>
      guobaSource.indexOf(
        `component: 'SOFT_GROUP_BEGIN',\n          label: '${nextLabel}'`,
        start + 1,
      ),
    )
    .filter((index) => index > start)
  const end =
    nextStarts.length > 0 ? Math.min(...nextStarts) : guobaSource.length
  return guobaSource.slice(start, end)
}

test('uses Guoba soft groups as independent configuration cards', () => {
  const labels = [
    ...guobaSource.matchAll(
      /component: 'SOFT_GROUP_BEGIN',\s*label: '([^']+)'/g,
    ),
  ].map((match) => match[1])

  assert.deepEqual(labels, cardLabels)
  assert.doesNotMatch(guobaSource, /component: 'Divider'/)
})

test('keeps every setting in its expected configuration card', () => {
  for (const [label, expectedFields] of Object.entries(expectedCardFields)) {
    const actualFields = [
      ...getCardSource(label).matchAll(/field: '([^']+)'/g),
    ].map((match) => match[1])
    assert.deepEqual(
      actualFields,
      expectedFields,
      `锅巴配置卡片字段异常：${label}`,
    )
  }
})

test('defines every configuration field exactly once', () => {
  const actualFields = [...guobaSource.matchAll(/field: '([^']+)'/g)].map(
    (match) => match[1],
  )
  const expectedFields = Object.values(expectedCardFields).flat()

  assert.deepEqual(actualFields, expectedFields)
  assert.equal(new Set(actualFields).size, actualFields.length)
})
