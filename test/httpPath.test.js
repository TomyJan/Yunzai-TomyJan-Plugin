import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { getContentType, resolvePublicFile } from '../model/httpPath.js'

const rootDir = path.resolve('data/httpServer/root')

test('resolves public files inside the configured HTTP root', () => {
  assert.equal(
    resolvePublicFile(rootDir, '/'),
    path.join(rootDir, 'index.html'),
  )
  assert.equal(
    resolvePublicFile(rootDir, '/tmp/report.pdf?download=1'),
    path.join(rootDir, 'tmp', 'report.pdf'),
  )
  assert.equal(
    resolvePublicFile(rootDir, '/images/My%20File.JPG'),
    path.join(rootDir, 'images', 'My File.JPG'),
  )
})

test('rejects traversal and absolute paths before filesystem access', () => {
  for (const requestUrl of [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%5csecret.txt',
    '/%2e%2e%5csecret.txt',
    '/C:/Windows/system.ini',
    '/file.txt%3Asecret',
    '/%00secret.txt',
    '/bad%ZZpath',
  ]) {
    assert.equal(resolvePublicFile(rootDir, requestUrl), null, requestUrl)
  }
})

test('does not confuse a sibling with a shared root prefix', () => {
  const siblingName = `${path.basename(rootDir)}-other`
  assert.equal(
    resolvePublicFile(rootDir, `/../${siblingName}/secret.txt`),
    null,
  )
})

test('maps supported HTTP file extensions case-insensitively', () => {
  assert.equal(getContentType('/tmp/index.HTML'), 'text/html')
  assert.equal(getContentType('/tmp/style.css'), 'text/css')
  assert.equal(getContentType('/tmp/app.js'), 'application/javascript')
  assert.equal(getContentType('/tmp/data.json'), 'application/json')
  assert.equal(getContentType('/tmp/image.PNG'), 'image/png')
  assert.equal(getContentType('/tmp/image.jpg'), 'image/jpeg')
  assert.equal(getContentType('/tmp/image.gif'), 'image/gif')
  assert.equal(getContentType('/tmp/image.svg'), 'image/svg+xml')
  assert.equal(getContentType('/tmp/file.pdf'), 'application/pdf')
  assert.equal(getContentType('/tmp/file.bin'), 'application/octet-stream')
})
