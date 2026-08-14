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

test('falls back to OneBot when ICQQ history lookup fails', async () => {
  const urls = await extractImageUrls({
    message: [
      { type: 'reply', id: 'message-5' },
      { type: 'text', text: 'ai图' },
    ],
    isGroup: true,
    source: { seq: 44 },
    group: {
      getChatHistory: async () => {
        throw new Error('history unavailable')
      },
    },
    bot: {
      sendApi: async () => ({
        data: {
          message: [
            {
              type: 'image',
              url: 'https://example.test/onebot-fallback.jpg',
            },
          ],
        },
      }),
    },
  })

  assert.deepEqual(urls, ['https://example.test/onebot-fallback.jpg'])
})

test('returns no image when OneBot get_msg fails', async () => {
  const urls = await extractImageUrls({
    message: [
      { type: 'reply', id: 'message-6' },
      { type: 'text', text: 'ai图' },
    ],
    bot: {
      sendApi: async () => {
        throw new Error('get_msg unavailable')
      },
    },
  })

  assert.deepEqual(urls, [])
})

test('returns no image for a message without image segments', async () => {
  const urls = await extractImageUrls({ message: 'ai图' })
  assert.deepEqual(urls, [])
})
