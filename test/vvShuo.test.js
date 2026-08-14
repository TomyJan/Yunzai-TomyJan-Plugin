import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VV_SHUO_COMMAND_PATTERN,
  buildVvShuoSearchUrl,
  normalizeVvShuoResponse,
  parseVvShuoRequest,
} from '../model/vvShuo.js'

test('parses VV command prefixes without deleting words from the query', () => {
  assert.deepEqual(parseVvShuoRequest('#vv说中国制造'), {
    content: '中国制造',
    enhanced: false,
    online: false,
  })
  assert.deepEqual(parseVvShuoRequest('#ZVVol说 在线教育怎么说'), {
    content: '在线教育怎么说',
    enhanced: true,
    online: true,
  })
  assert.deepEqual(parseVvShuoRequest('维为增强说：说话的艺术'), {
    content: '说话的艺术',
    enhanced: true,
    online: false,
  })
  assert.deepEqual(parseVvShuoRequest('张维为说: 科技'), {
    content: '科技',
    enhanced: false,
    online: false,
  })
})

test('shares the command pattern and rejects unrelated messages', () => {
  const command = new RegExp(VV_SHUO_COMMAND_PATTERN)

  assert.equal(command.test('#VV在线说测试'), true)
  assert.equal(command.test('普通聊天'), false)
  assert.equal(parseVvShuoRequest('普通聊天'), null)
  assert.equal(parseVvShuoRequest(null), null)
})

test('builds an encoded VV search URL for the selected endpoint', () => {
  const url = new URL(
    buildVvShuoSearchUrl({
      content: '制造业 & AI',
      enhanced: true,
      count: 2,
    }),
  )

  assert.equal(url.origin, 'https://api.zvv.quest')
  assert.equal(url.pathname, '/enhancedsearch')
  assert.equal(url.searchParams.get('q'), '制造业 & AI')
  assert.equal(url.searchParams.get('n'), '2')
})

test('normalizes successful VV image responses', () => {
  assert.deepEqual(
    normalizeVvShuoResponse({
      code: 200,
      data: ['https://example.test/1.jpg', 'https://example.test/2.jpg'],
    }),
    ['https://example.test/1.jpg', 'https://example.test/2.jpg'],
  )
})

test('explains VV API errors and empty results', () => {
  assert.throws(
    () => normalizeVvShuoResponse({ code: 429, msg: '请求过快' }),
    /VV 说有问题\(429\): 请求过快/,
  )
  assert.throws(
    () => normalizeVvShuoResponse({ code: 500 }, { enhanced: true }),
    /VV 说增强版有问题\(500\): 但没说啥问题/,
  )
  assert.throws(
    () => normalizeVvShuoResponse({ code: 200, data: [] }),
    /VV 好像没说过这个/,
  )
  assert.throws(() => normalizeVvShuoResponse(null), /VV 说有问题/)
})
