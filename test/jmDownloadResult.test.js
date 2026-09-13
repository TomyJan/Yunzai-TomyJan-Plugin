import assert from 'node:assert/strict'
import test from 'node:test'

import * as jmResults from '../model/jmDownloadResult.js'

const { classifyJmDownloadResult } = jmResults

test('classifies a JMComic command without output', () => {
  assert.deepEqual(
    classifyJmDownloadResult({ output: '', err: 'jmcomic: command failed' }),
    { type: 'no_output', message: 'jmcomic: command failed' },
  )
  assert.deepEqual(classifyJmDownloadResult(null), {
    type: 'no_output',
    message: '未知错误',
  })
})

test('recognizes a completed JMComic download', () => {
  assert.deepEqual(
    classifyJmDownloadResult({ output: '准备中\n本子下载完成\n' }),
    { type: 'success' },
  )
})

test('extracts JSON and plain-text JMComic exception messages', () => {
  assert.deepEqual(
    classifyJmDownloadResult({
      output:
        'jmcomic.jm_exception.JmcomicException: download, response ({"errorMsg":"API denied"})',
    }),
    { type: 'known_error', message: 'API denied' },
  )
  assert.deepEqual(
    classifyJmDownloadResult({
      output:
        "jmcomic.jm_exception.JmcomicException: download, cause ('download denied\\nretry')",
    }),
    { type: 'known_error', message: 'download denied\nretry' },
  )
})

test('uses a concise message for unavailable JMComic albums', () => {
  assert.deepEqual(
    classifyJmDownloadResult({
      output:
        "jmcomic.jm_exception.JmcomicException: 请求的本子不存在, cause ('not found')",
    }),
    { type: 'known_error', message: '此 ID 不存在或登录可见' },
  )
})

test('keeps unrecognized JMComic output for the diagnostic forward message', () => {
  assert.deepEqual(
    classifyJmDownloadResult({
      output: 'jmcomic.jm_exception.Unknown: changed format\\nsecond line',
    }),
    {
      type: 'unknown_error',
      output: 'jmcomic.jm_exception.Unknown: changed format\nsecond line',
    },
  )
  assert.deepEqual(classifyJmDownloadResult({ output: 'unexpected output' }), {
    type: 'unknown_error',
    output: 'unexpected output',
  })
})

test('falls back to a PDF link when group upload throws without a message', async () => {
  const replies = []
  const recalled = []
  const logged = []
  const event = {
    isGroup: true,
    group: { recallMsg: async (id) => recalled.push(id) },
    reply: async (message) => {
      replies.push(message)
      return { message_id: 42 }
    },
  }

  assert.equal(typeof jmResults.handleJmPdfUploadFailure, 'function')
  await jmResults.handleJmPdfUploadFailure({ code: -1 }, 2, event, {
    sendLink: async () => '点击链接下载: https://example.test/file',
    logError: (message) => logged.push(message),
  })

  assert.deepEqual(recalled, [42])
  assert.equal(replies.length, 2)
  assert.match(replies[0], /文件发送失败.*未知错误.*将尝试上传到内置服务器/su)
  assert.match(replies[1], /点击链接下载/u)
  assert.deepEqual(logged, ['发送文件失败: 未知错误'])
})

test('recalls a private failure notice before delivering the PDF link', async () => {
  const replies = []
  const recalled = []
  const event = {
    isPrivate: true,
    private: { recallMsg: async (id) => recalled.push(id) },
    reply: async (message) => {
      replies.push(message)
      return { message_id: 17 }
    },
  }

  assert.equal(typeof jmResults.handleJmPdfUploadFailure, 'function')
  await jmResults.handleJmPdfUploadFailure('unknown highway error', 2, event, {
    sendLink: async () => '临时下载链接',
    logError: () => {},
  })

  assert.deepEqual(recalled, [17])
  assert.match(replies[0], /未知通道错误/u)
  assert.equal(replies[1], '临时下载链接')
})

test('keeps group-space failures on the file-only response path', async () => {
  const replies = []
  let linkCreated = false
  const event = {
    isGroup: true,
    reply: async (message) => replies.push(message),
  }

  assert.equal(typeof jmResults.handleJmPdfUploadFailure, 'function')
  await jmResults.handleJmPdfUploadFailure(
    new Error('group space not enough'),
    2,
    event,
    {
      sendLink: async () => {
        linkCreated = true
      },
      logError: () => {},
    },
  )

  assert.deepEqual(replies, ['文件发送失败, 错误信息: \n群文件空间不足'])
  assert.equal(linkCreated, false)
})

test('redacts arbitrary adapter errors before logging or replying', async () => {
  const replies = []
  const logged = []
  const event = { reply: async (message) => replies.push(message) }

  assert.equal(typeof jmResults.handleJmPdfUploadFailure, 'function')
  await jmResults.handleJmPdfUploadFailure(
    { message: 'upload failed token=secret https://example.test/private' },
    1,
    event,
    { logError: (message) => logged.push(message) },
  )

  assert.equal(replies.length, 1)
  assert.doesNotMatch(replies[0], /secret|example\.test/u)
  assert.doesNotMatch(logged[0], /secret|example\.test/u)
})

test('does not expose PDF paths or embedded passwords from upload errors', async () => {
  const replies = []
  const logged = []

  await jmResults.handleJmPdfUploadFailure(
    new Error('ENOENT /data/private/Password_hunter2.pdf'),
    1,
    { reply: async (message) => replies.push(message) },
    { logError: (message) => logged.push(message) },
  )

  assert.equal(replies.length, 1)
  assert.doesNotMatch(replies[0], /\/data\/private|hunter2/u)
  assert.doesNotMatch(logged[0], /\/data\/private|hunter2/u)
})
