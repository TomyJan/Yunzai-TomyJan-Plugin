import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyJmDownloadResult } from '../model/jmDownloadResult.js'

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
