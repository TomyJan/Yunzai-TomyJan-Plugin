import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkJmBlacklists,
  extractJmAlbumId,
  loadJmvAuthors,
  normalizeJmAlbumId,
  parseJmvAuthors,
  redactJmError,
} from '../model/jmBlacklist.js'

test('extracts album IDs from complete JM command variants', () => {
  assert.equal(extractJmAlbumId('#JMComic 123'), '123')
  assert.equal(extractJmAlbumId('#jmcomic：00123'), '00123')
  assert.equal(extractJmAlbumId('JM: 123'), '123')
  assert.equal(extractJmAlbumId('not a JM command'), null)
})

test('normalizes decimal JM album IDs without numeric precision loss', () => {
  assert.equal(normalizeJmAlbumId('000123'), '123')
  assert.equal(normalizeJmAlbumId(123), '123')
  assert.equal(normalizeJmAlbumId('000000'), '0')
  assert.equal(
    normalizeJmAlbumId('00090071992547409931234567890'),
    '90071992547409931234567890',
  )
  assert.equal(normalizeJmAlbumId(Number.MAX_SAFE_INTEGER), '9007199254740991')
  assert.equal(normalizeJmAlbumId(Number.MAX_SAFE_INTEGER + 1), null)
  assert.equal(normalizeJmAlbumId(-1), null)
  assert.equal(normalizeJmAlbumId(1.5), null)
  assert.equal(normalizeJmAlbumId('1'.repeat(64)), '1'.repeat(64))
  assert.equal(normalizeJmAlbumId('1'.repeat(65)), null)
  assert.equal(normalizeJmAlbumId(`${'0'.repeat(100)}1`), '1')
  assert.equal(normalizeJmAlbumId('12x'), null)
  assert.equal(normalizeJmAlbumId(''), null)
})

test('parses all author names exposed by jmv', () => {
  const output = '  ✍️ 作者:  Alice, Bob, 陈某\n'

  assert.deepEqual(parseJmvAuthors(output), ['Alice', 'Bob', '陈某'])
  assert.deepEqual(parseJmvAuthors('  ✍️ 作者:  未知\n'), [])
  assert.deepEqual(
    parseJmvAuthors('  ✍️ 作者: Alice, Bob, Carol ...等12个\n'),
    ['Alice', 'Bob', 'Carol'],
  )
  assert.deepEqual(
    parseJmvAuthors('📖 标题: 作者: SafeTitle\n  ✍️ 作者: BlockedAuthor\n'),
    ['BlockedAuthor'],
  )
})

test('rejects jmv output without an author field', () => {
  assert.throws(
    () => parseJmvAuthors('📖 标题: Example'),
    /无法解析 jmv 作者字段/,
  )
})

test('checks album ID before author lookup', async () => {
  let authorLookupCount = 0
  const result = await checkJmBlacklists({
    albumId: '000123',
    albumIdBlacklist: { enable: true, ids: [123] },
    authorNameBlacklist: { enable: true, names: ['Alice'] },
    loadAuthors: async () => {
      authorLookupCount += 1
      return ['Alice']
    },
  })

  assert.deepEqual(result, { type: 'albumId', value: '123' })
  assert.equal(authorLookupCount, 0)
})

test('ignores invalid album ID blacklist entries', async () => {
  const result = await checkJmBlacklists({
    albumId: '123',
    albumIdBlacklist: {
      enable: true,
      ids: ['12x', '', null, undefined, '-1', '000124'],
    },
    authorNameBlacklist: { enable: false, names: [] },
    loadAuthors: async () => {
      throw new Error('author lookup must stay disabled')
    },
  })

  assert.equal(result, null)
})

test('skips author lookup when the author blacklist is disabled', async () => {
  let authorLookupCount = 0
  const result = await checkJmBlacklists({
    albumId: '123',
    albumIdBlacklist: { enable: false, ids: ['123'] },
    authorNameBlacklist: { enable: false, names: ['Alice'] },
    loadAuthors: async () => {
      authorLookupCount += 1
      return ['Alice']
    },
  })

  assert.equal(result, null)
  assert.equal(authorLookupCount, 0)
})

test('matches trimmed Latin author names case-insensitively', async () => {
  const result = await checkJmBlacklists({
    albumId: '123',
    albumIdBlacklist: { enable: false, ids: [] },
    authorNameBlacklist: { enable: true, names: [' alice '] },
    loadAuthors: async () => ['Alice', 'Bob'],
  })

  assert.deepEqual(result, { type: 'authorName', value: 'Alice' })
})

test('matches author names exactly instead of by substring', async () => {
  const result = await checkJmBlacklists({
    albumId: '123',
    albumIdBlacklist: { enable: false, ids: [] },
    authorNameBlacklist: { enable: true, names: ['Ali'] },
    loadAuthors: async () => ['Alice'],
  })

  assert.equal(result, null)
})

test('rethrows author lookup failures when author checks are enabled', async () => {
  const failure = new Error('jmv unavailable')

  await assert.rejects(
    checkJmBlacklists({
      albumId: '123',
      albumIdBlacklist: { enable: false, ids: [] },
      authorNameBlacklist: { enable: true, names: ['Alice'] },
      loadAuthors: async () => {
        throw failure
      },
    }),
    (error) => error === failure,
  )
})

test('loads authors with jmv and the active option file', async () => {
  let command = ''
  const authors = await loadJmvAuthors({
    albumId: '123',
    optionPath: '/bot/data/JMComic/option.yml',
    execute: async (value) => {
      command = value
      return { output: '  ✍️ 作者:  Alice, Bob', err: '' }
    },
  })

  assert.equal(command, 'jmv 123 --option="/bot/data/JMComic/option.yml" --yes')
  assert.deepEqual(authors, ['Alice', 'Bob'])
})

test('fails closed when jmv has no output', async () => {
  await assert.rejects(
    loadJmvAuthors({
      albumId: '123',
      optionPath: '/bot/data/JMComic/option.yml',
      execute: async () => ({ output: '', err: 'jmv: command not found' }),
    }),
    /jmv 查询失败: jmv: command not found/,
  )
})

test('fails closed when jmv exits unsuccessfully with output', async () => {
  await assert.rejects(
    loadJmvAuthors({
      albumId: '123',
      optionPath: '/bot/data/JMComic/option.yml',
      execute: async () => ({
        output: '✍️ 作者: Alice',
        err: 'process exited 1',
        failed: true,
      }),
    }),
    /jmv 查询失败/,
  )
})

test('rethrows jmv execution failures', async () => {
  const failure = new Error('execution failed')

  await assert.rejects(
    loadJmvAuthors({
      albumId: '123',
      optionPath: '/bot/data/JMComic/option.yml',
      execute: async () => {
        throw failure
      },
    }),
    (error) => error === failure,
  )
})

test('rejects an invalid album ID before invoking jmv', async () => {
  let executionCount = 0

  await assert.rejects(
    loadJmvAuthors({
      albumId: '12x',
      optionPath: '/bot/data/JMComic/option.yml',
      execute: async () => {
        executionCount += 1
        return { output: '✍️ 作者: Alice', err: '' }
      },
    }),
    /无效的 JMComic ID/,
  )
  assert.equal(executionCount, 0)
})

test('redacts sensitive jmv errors into a bounded single-line summary', () => {
  const error = new Error(
    [
      'request http://user:password@127.0.0.1:7890/path?api_key=secret-key',
      'Cookie: session=secret',
      'Authorization: Bearer token-value',
      'api_key=secret-key',
      'user=plain-user token=plain-token password=plain-password secret=plain-secret',
      'proxy_password="proxy-pass"',
      "client_secret: 'client-secret'",
      "refresh_token='refresh-token'",
      "service_credential: 'credential-value'",
      `details ${'x'.repeat(500)}`,
    ].join('\n'),
  )
  const summary = redactJmError(error)

  assert.doesNotMatch(
    summary,
    /session=secret|token-value|secret-key|plain-user|plain-token|plain-password|plain-secret|proxy-pass|client-secret|refresh-token|credential-value/,
  )
  assert.doesNotMatch(summary, /https?:\/\//)
  assert.doesNotMatch(summary, /[\r\n]/)
  assert.ok(summary.length <= 300)
  assert.equal(redactJmError(null), '未知错误')
  assert.equal(redactJmError(''), '未知错误')
})
