import assert from 'node:assert/strict'
import test from 'node:test'

import { extractImageUrls, isAiImageCommand } from '../model/aiImageMessage.js'

test('matches ai图 command case-insensitively with optional hash prefix', () => {
  assert.equal(isAiImageCommand('ai图'), true)
  assert.equal(isAiImageCommand('AI图'), true)
  assert.equal(isAiImageCommand('#aI图'), true)
  assert.equal(isAiImageCommand('ai图说明'), false)
})

test('extracts current message images before quoted images', async () => {
  const urls = await extractImageUrls({
    message: [
      { type: 'text', text: 'ai图' },
      { type: 'image', url: 'https://example.test/current.png' },
    ],
    source: { message_id: 1 },
    getReply: async () => ({
      message: [{ type: 'image', url: 'https://example.test/quoted.png' }],
    }),
  })

  assert.deepEqual(urls, ['https://example.test/current.png'])
})

test('extracts images from quoted message when current message has none', async () => {
  const urls = await extractImageUrls({
    message: [{ type: 'text', text: 'ai图' }],
    source: { message_id: 2 },
    getReply: async () => ({
      message: [
        { type: 'image', file: 'https://example.test/quoted.jpg' },
        { type: 'image', url: 'https://example.test/quoted.jpg' },
      ],
    }),
  })

  assert.deepEqual(urls, ['https://example.test/quoted.jpg'])
})

test('returns no image for a message without image segments', async () => {
  const urls = await extractImageUrls({ message: 'ai图' })
  assert.deepEqual(urls, [])
})
