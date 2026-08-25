import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { getGuobaSchemas } from '../model/guobaSchemas.js'

const supportSource = fs.readFileSync(
  new URL('../guoba.support.js', import.meta.url),
  'utf8',
)

const cardLabels = [
  '日志设置',
  '代理设置',
  'JMComic 功能设置',
  'VV 说设置',
  'AI 图片识别设置',
  '图片 EXIF 定位设置',
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
  '图片 EXIF 定位设置': [
    'imageExif.enable',
    'imageExif.provider',
    'imageExif.honorific',
    'imageExif.timeoutMs',
    'imageExif.maxFileSize',
    'imageExif.geocodingEndpoint',
    'imageExif.amap.apiKeys',
    'imageExif.attribution',
    'imageExif.proxy.enable',
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

test('uses provider selection and tag input for EXIF geocoding', () => {
  const schemas = getGuobaSchemas()
  const provider = schemas.find(
    (schema) => schema.field === 'imageExif.provider',
  )
  const amapKeys = schemas.find(
    (schema) => schema.field === 'imageExif.amap.apiKeys',
  )

  assert.equal(provider.component, 'Select')
  assert.deepEqual(provider.componentProps.options, [
    { label: 'Nominatim 兼容', value: 'nominatim' },
    { label: '高德开放平台', value: 'amap' },
  ])
  assert.equal(amapKeys.component, 'GTags')
})

function splitCards(schemas) {
  const cards = new Map()
  let currentCard
  for (const schema of schemas) {
    if (schema.component === 'SOFT_GROUP_BEGIN') {
      currentCard = []
      cards.set(schema.label, currentCard)
    } else if (currentCard) {
      currentCard.push(schema)
    }
  }
  return cards
}

test('uses Guoba soft groups as independent configuration cards', () => {
  const schemas = getGuobaSchemas()
  const labels = schemas
    .filter((schema) => schema.component === 'SOFT_GROUP_BEGIN')
    .map((schema) => schema.label)

  assert.deepEqual(labels, cardLabels)
  assert.equal(
    schemas.some((schema) => schema.component === 'Divider'),
    false,
  )
})

test('keeps every setting in its expected configuration card', () => {
  const cards = splitCards(getGuobaSchemas())
  for (const [label, expectedFields] of Object.entries(expectedCardFields)) {
    assert.deepEqual(
      cards.get(label)?.map((schema) => schema.field),
      expectedFields,
      `锅巴配置卡片字段异常：${label}`,
    )
  }
})

test('defines every configuration field exactly once', () => {
  const actualFields = getGuobaSchemas()
    .map((schema) => schema.field)
    .filter(Boolean)
  const expectedFields = Object.values(expectedCardFields).flat()

  assert.deepEqual(actualFields, expectedFields)
  assert.equal(new Set(actualFields).size, actualFields.length)
})

test('returns an isolated schema copy for each Guoba request', () => {
  const first = getGuobaSchemas()
  const second = getGuobaSchemas()

  first[0].label = 'changed'
  first.find((schema) => schema.componentProps)?.componentProps.options?.pop()

  assert.equal(second[0].label, '日志设置')
  assert.equal(
    second.find((schema) => schema.field === 'logger.logLevel').componentProps
      .options.length,
    4,
  )
})

test('uses the shared schemas in the Guoba runtime adapter', () => {
  assert.match(supportSource, /from '.\/model\/guobaSchemas\.js'/)
  assert.match(supportSource, /schemas: getGuobaSchemas\(\)/)
  assert.doesNotMatch(supportSource, /schemas:\s*\[/)
})
