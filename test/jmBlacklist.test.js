import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkJmBlacklists,
  loadJmvAuthors,
  normalizeJmAlbumId,
  parseJmvAuthors,
} from '../model/jmBlacklist.js'

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
    parseJmvAuthors(
      '📖 标题: 作者: SafeTitle\n  ✍️ 作者: BlockedAuthor\n',
    ),
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

  assert.equal(
    command,
    'jmv 123 --option="/bot/data/JMComic/option.yml" --yes',
  )
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

test('rejects jmv output without an author field', async () => {
  await assert.rejects(
    loadJmvAuthors({
      albumId: '123',
      optionPath: '/bot/data/JMComic/option.yml',
      execute: async () => ({ output: '📖 标题: Example', err: '' }),
    }),
    /无法解析 jmv 作者字段/,
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
