import assert from 'node:assert/strict'
import test from 'node:test'

import {
  categorizeUserStatus,
  formatDateUTC8,
  formatUserStatusReport,
  getGracePeriodInfo,
  getInvalidReason,
  getUserStatus,
  isUserValid,
  resolveTaskResult,
} from '../model/eduAuthRules.js'

const now = Date.parse('2026-08-14T10:00:00Z')

function activeUser(overrides = {}) {
  return {
    status: 'active',
    expireAt: '2026-08-20T10:00:00',
    role: { graceDays: 3, graceAuthCount: 2 },
    graceUsed: 0,
    ...overrides,
  }
}

test('formats UTC dates in UTC+8 without changing the input', () => {
  const date = new Date('2026-08-14T16:05:00Z')

  assert.equal(formatDateUTC8(date), '2026.08.15 00:05')
  assert.equal(formatDateUTC8(date, false), '2026.08.15')
  assert.equal(date.toISOString(), '2026-08-14T16:05:00.000Z')
})

test('classifies explicit and active EDU user states', () => {
  assert.equal(getUserStatus(null, now), 'unknown')
  assert.equal(getUserStatus({ status: 'pending' }, now), 'pending')
  assert.equal(getUserStatus({ status: 'banned' }, now), 'banned')
  assert.equal(getUserStatus({ status: 'disabled' }, now), 'disabled')
  assert.equal(getUserStatus({ status: 'other' }, now), 'unknown')
  assert.equal(getUserStatus(activeUser({ expireAt: null }), now), 'active')
  assert.equal(
    getUserStatus(activeUser({ expireAt: 'not-a-date' }), now),
    'unknown',
  )
  assert.equal(
    getUserStatus(activeUser({ expireAt: '2026-08-14T10:00:00Z' }), now),
    'active',
  )
})

test('requires both grace time and authentication uses to remain', () => {
  const graceUser = activeUser({ expireAt: '2026-08-13T10:00:00Z' })

  assert.equal(getUserStatus(graceUser, now), 'grace_period')
  assert.equal(
    getUserStatus(activeUser({ ...graceUser, graceUsed: 2 }), now),
    'expired',
  )
  assert.equal(
    getUserStatus(
      activeUser({
        ...graceUser,
        expireAt: '2026-08-11T10:00:00Z',
      }),
      now,
    ),
    'expired',
  )
})

test('reports deterministic grace period details', () => {
  assert.deepEqual(getGracePeriodInfo(null, now), {
    isInGracePeriod: false,
  })
  assert.deepEqual(getGracePeriodInfo(activeUser({ expireAt: null }), now), {
    isInGracePeriod: false,
    daysRemaining: Infinity,
  })
  assert.deepEqual(
    getGracePeriodInfo(activeUser({ expireAt: '2026-08-16T09:59:59Z' }), now),
    { isInGracePeriod: false, daysRemaining: 2 },
  )
  assert.deepEqual(
    getGracePeriodInfo(
      activeUser({ expireAt: '2026-08-12T09:59:59Z', graceUsed: 1 }),
      now,
    ),
    {
      isInGracePeriod: true,
      usesRemaining: 1,
      expiredDaysAgo: 2,
      graceAuthCount: 2,
      graceDays: 3,
      graceDaysRemaining: 1,
      graceUsed: 1,
    },
  )
})

test('explains validity using the same fixed clock', () => {
  const expired = activeUser({
    expireAt: '2026-08-01T10:00:00Z',
    role: { graceDays: 0, graceAuthCount: 0 },
  })

  assert.equal(isUserValid(activeUser(), now), true)
  assert.equal(isUserValid(expired, now), false)
  assert.equal(getInvalidReason(null, now), '未注册或未绑定QQ')
  assert.equal(getInvalidReason({ status: 'other' }, now), '未知状态')
  assert.equal(getInvalidReason({ status: 'pending' }, now), '待审核')
  assert.equal(getInvalidReason({ status: 'banned' }, now), '已封禁')
  assert.equal(getInvalidReason({ status: 'disabled' }, now), '已停用')
  assert.equal(getInvalidReason(expired, now), '已过期 (13天前)')
  assert.equal(
    getInvalidReason(activeUser({ expireAt: '2026-08-13T10:00:00Z' }), now),
    '宽限期内',
  )
  assert.equal(getInvalidReason(activeUser(), now), '正常')
})

test('resolves task metadata before legacy status fallbacks', () => {
  const processing = {
    defaultMessage: '正在排队',
    processing: true,
    terminal: false,
  }
  const success = {
    defaultMessage: '认证完成',
    processing: false,
    terminal: true,
    severity: 'success',
  }

  assert.deepEqual(resolveTaskResult({ taskCode: 100 }, processing), {
    done: false,
    success: false,
    processing: true,
    message: '正在排队',
    metadata: processing,
  })
  assert.deepEqual(resolveTaskResult({ taskCode: 0 }, success), {
    done: true,
    success: true,
    processing: false,
    message: '认证完成',
    metadata: success,
  })
  assert.deepEqual(
    resolveTaskResult(
      { taskCode: 300 },
      {
        defaultMessage: '认证端点不可用',
        processing: false,
        terminal: true,
        severity: 'error',
      },
    ),
    {
      done: true,
      success: false,
      processing: false,
      message: '认证端点不可用',
      metadata: {
        defaultMessage: '认证端点不可用',
        processing: false,
        terminal: true,
        severity: 'error',
      },
    },
  )
  assert.equal(
    resolveTaskResult({ status: 'failed', message: '上游拒绝' }).message,
    '上游拒绝',
  )
  assert.deepEqual(resolveTaskResult({ status: 'success' }), {
    done: true,
    success: true,
    processing: false,
    message: '认证成功！',
    metadata: null,
  })
})

test('categorizes registered and unregistered group members', () => {
  const invalidUsers = []
  const result = categorizeUserStatus({
    allUsers: {
      10001: activeUser(),
      10002: activeUser({ status: 'disabled' }),
      10003: activeUser(),
      10004: null,
      10006: activeUser({ expireAt: '2026-08-13T10:00:00Z' }),
      10007: activeUser({ expireAt: '2026-08-01T10:00:00Z' }),
      10008: activeUser({ status: 'pending' }),
      10009: activeUser({ status: 'banned' }),
      10010: activeUser({ status: 'other' }),
    },
    groupMembers: [
      { user_id: 10001, nickname: 'Active' },
      { user_id: 10002, nickname: 'Disabled' },
      { user_id: 10005, nickname: 'New member' },
      { user_id: 10006 },
      { user_id: 10007 },
      { user_id: 10008 },
      { user_id: 10009 },
      { user_id: 10010 },
    ],
    unkQQUser: 2,
    now,
    onInvalidUser: (qq) => invalidUsers.push(qq),
  })

  assert.deepEqual(
    result.normalUsers.map((user) => user.qq),
    ['10001'],
  )
  assert.deepEqual(
    result.disabledUsers.map((user) => user.qq),
    ['10002'],
  )
  assert.deepEqual(
    result.validNotInGroup.map((user) => user.qq),
    ['10003'],
  )
  assert.deepEqual(
    result.gracePeriodUsers.map((user) => user.qq),
    ['10006'],
  )
  assert.deepEqual(
    result.expiredUsers.map((user) => user.qq),
    ['10007'],
  )
  assert.deepEqual(
    result.pendingUsers.map((user) => user.qq),
    ['10008'],
  )
  assert.deepEqual(
    result.bannedUsers.map((user) => user.qq),
    ['10009'],
  )
  assert.deepEqual(
    result.invalidInGroup.map((user) => user.qq),
    ['10010'],
  )
  assert.deepEqual(result.unregisteredInGroup, [
    { qq: '10005', nickname: 'New member' },
  ])
  assert.equal(result.unkQQUser, 2)
  assert.deepEqual(invalidUsers, ['10004'])
})

test('formats every populated EDU report category', () => {
  const message = formatUserStatusReport({
    success: true,
    data: {
      normalUsers: [{}],
      gracePeriodUsers: [{}],
      expiredUsers: [{}],
      pendingUsers: [{}],
      bannedUsers: [{}],
      disabledUsers: [{}],
      invalidInGroup: [{}],
      validNotInGroup: [{}],
      unregisteredInGroup: [{}],
      unkQQUser: 1,
    },
  })

  for (const line of [
    '✅ 正常用户: 1',
    '⏳ 宽限期内: 1',
    '⚠️ 过期用户: 1',
    '⏹️ 已停用: 1',
    '❌ 其他无效: 1',
    '🔍 待审核: 1',
    '🚫 已封禁: 1',
    '📭 有效未加群: 1',
    '👻 群内未注册: 1',
    '❓ 未绑定QQ: 1',
  ]) {
    assert.match(message, new RegExp(line))
  }
  assert.equal(formatUserStatusReport(null), '获取用户状态失败')
  assert.equal(
    formatUserStatusReport({ success: true, data: [] }),
    '用户状态数据格式错误',
  )
})
