import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import { checkC2pa } from '../model/aiImageProviders.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const transientNativeError =
  /being used by another process|used by another process|not a valid Win32 application|file too short|invalid ELF header|text file busy/i

async function loadNativeBinding() {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = await checkC2pa(png, {
      mimeType: 'image/png',
      timeoutMs: 5000,
    })
    if (!transientNativeError.test(result.error || '') || attempt === 10) {
      return result
    }
    await delay(500)
  }
}

test(
  'loads the native C2PA reader through the default integration',
  { timeout: 10000 },
  async () => {
    const result = await loadNativeBinding()

    assert.equal(result.provider, 'c2pa')
    assert.equal(result.status, 'not_detected', result.error)
  },
)
