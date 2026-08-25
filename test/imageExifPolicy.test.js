import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSenderDisplayName,
  shouldInspectImageEvent,
} from '../model/imageExifPolicy.js'

test('allows private messages by default and respects the private switch', () => {
  const event = { isPrivate: true, user_id: 10001 }

  assert.equal(shouldInspectImageEvent(event, {}), true)
  assert.equal(shouldInspectImageEvent(event, { allowPrivate: false }), false)
})

test('allows group messages only when the group is in the allowlist', () => {
  const event = { isGroup: true, group_id: 725571000, user_id: 10001 }

  assert.equal(shouldInspectImageEvent(event, { allowedGroups: [] }), false)
  assert.equal(
    shouldInspectImageEvent(event, { allowedGroups: ['725571000'] }),
    true,
  )
  assert.equal(
    shouldInspectImageEvent(event, { allowedGroups: [725571000] }),
    true,
  )
  assert.equal(
    shouldInspectImageEvent(event, { allowedGroups: ['123456'] }),
    false,
  )
  assert.equal(
    shouldInspectImageEvent(event, {
      allowedGroups: '123456, 725571000，999999',
    }),
    true,
  )
})

test('supports private event markers used by different adapters', () => {
  assert.equal(shouldInspectImageEvent({ message_type: 'private' }, {}), true)
  assert.equal(shouldInspectImageEvent({ friend: {} }, {}), true)
})

test('does not treat unknown events as private messages', () => {
  assert.equal(shouldInspectImageEvent({}, {}), false)
  assert.equal(shouldInspectImageEvent({ isPrivate: false }, {}), false)
})

test('uses group card before sender and event nicknames', () => {
  assert.equal(
    getSenderDisplayName({
      sender: { card: '群名片', nickname: '发送者昵称' },
      nickname: '事件昵称',
    }),
    '群名片',
  )
  assert.equal(
    getSenderDisplayName({ sender: { nickname: '发送者昵称' } }),
    '发送者昵称',
  )
  assert.equal(getSenderDisplayName({ nickname: '事件昵称' }), '事件昵称')
})

test('sanitizes display names and limits them to 32 Unicode characters', () => {
  assert.equal(
    getSenderDisplayName({ sender: { card: '  小明\n\t同学  ' } }),
    '小明 同学',
  )
  assert.equal(
    getSenderDisplayName({ sender: { nickname: '甲'.repeat(40) } }),
    '甲'.repeat(32),
  )
  assert.equal(getSenderDisplayName({ nickname: 10001 }), '10001')
  assert.equal(
    getSenderDisplayName({ nickname: '小明[CQ:at,qq=all]\u202e' }),
    '小明',
  )
})

test('falls back to a neutral name', () => {
  assert.equal(getSenderDisplayName({ sender: { card: '\n' } }), '朋友')
})
