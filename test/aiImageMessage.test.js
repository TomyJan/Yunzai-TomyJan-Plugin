import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { extractImageUrls, isAiImageCommand } from '../model/aiImageMessage.js'

const appSource = fs.readFileSync(
  new URL('../apps/aiImage.js', import.meta.url),
  'utf8',
)

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

test('extracts nested quoted images from TRSS reply records', async () => {
  const urls = await extractImageUrls({
    message: [{ type: 'text', text: 'ai图' }],
    reply_id: 3,
    getReply: async () => [
      {
        message: [
          {
            type: 'image',
            data: { url: 'https://example.test/trss.png' },
          },
        ],
      },
    ],
  })

  assert.deepEqual(urls, ['https://example.test/trss.png'])
})

test('extracts quoted images wrapped in raw_message', async () => {
  const urls = await extractImageUrls({
    message: [{ type: 'text', text: 'ai图' }],
    reply_id: 4,
    getReply: async () => ({
      raw_message: [
        { type: 'image', url: 'https://example.test/raw-message.png' },
      ],
    }),
  })

  assert.deepEqual(urls, ['https://example.test/raw-message.png'])
})

test('extracts quoted images from ICQQ chat history', async () => {
  const urls = await extractImageUrls({
    message: [{ type: 'text', text: 'ai图' }],
    isGroup: true,
    source: { seq: 42 },
    group: {
      getChatHistory: async (seq, count) => {
        assert.equal(seq, 42)
        assert.equal(count, 1)
        return [
          {
            message: [{ type: 'image', url: 'https://example.test/icqq.webp' }],
          },
        ]
      },
    },
  })

  assert.deepEqual(urls, ['https://example.test/icqq.webp'])
})

test('falls back to ICQQ history when getReply fails', async () => {
  const urls = await extractImageUrls({
    message: [{ type: 'text', text: 'ai图' }],
    isGroup: true,
    source: { seq: 43 },
    getReply: async () => {
      throw new Error('adapter does not support getReply')
    },
    group: {
      getChatHistory: async () => [
        {
          message: [
            {
              type: 'image',
              url: 'https://example.test/icqq-fallback.png',
            },
          ],
        },
      ],
    },
  })

  assert.deepEqual(urls, ['https://example.test/icqq-fallback.png'])
})

test('extracts quoted images through OneBot get_msg', async () => {
  const urls = await extractImageUrls({
    message: [
      { type: 'reply', data: { id: 'message-4' } },
      { type: 'text', data: { text: 'ai图' } },
    ],
    bot: {
      sendApi: async (action, params) => {
        assert.equal(action, 'get_msg')
        assert.deepEqual(params, { message_id: 'message-4' })
        return {
          data: {
            message: [
              {
                type: 'image',
                data: { file: 'https://example.test/onebot.jpg' },
              },
            ],
          },
        }
      },
    },
  })

  assert.deepEqual(urls, ['https://example.test/onebot.jpg'])
})

test('returns no image for a message without image segments', async () => {
  const urls = await extractImageUrls({ message: 'ai图' })
  assert.deepEqual(urls, [])
})

test('wires the app to shared parsing, full config and plugin logger', () => {
  assert.match(appSource, /from '..\/model\/aiImageMessage\.js'/)
  assert.match(appSource, /redactAiImageError/)
  assert.match(
    appSource,
    /inspectAiImage\(imageUrls\[0\], config\.getConfig\(\), \{\s*logger: tjLogger,\s*\}\)/,
  )
  assert.match(
    appSource,
    /const safeMessage = redactAiImageError\(error, config\.getConfig\(\)\)/,
  )
  assert.match(appSource, /`❌ AI 图片识别失败\\n\\n\$\{safeMessage\}`/)
  assert.match(appSource, /reg: '\^#\?\[aA\]\[iI\]图\$'/)
})
