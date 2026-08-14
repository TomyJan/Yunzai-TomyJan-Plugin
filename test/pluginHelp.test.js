import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { parse } from 'yaml'

const rootUrl = new URL('../', import.meta.url)
const helpData = parse(
  fs.readFileSync(new URL('data/system/yaml/help.yaml', rootUrl), 'utf8'),
)

test('lists AI image inspection in the plugin menu with a valid icon', () => {
  const utilityGroup = helpData.find((group) => group.group === '实用功能')
  const item = utilityGroup?.list?.find((entry) => entry.title.includes('ai图'))

  assert.deepEqual(item, {
    icon: 'tomyjan',
    title: '#ai图 + 图片/引用图片',
    desc: '检测图片中的 AI 生成或来源信号',
  })
  assert.equal(
    fs.existsSync(
      new URL(`resources/img/common/icon/${item.icon}.png`, rootUrl),
    ),
    true,
  )
})
