import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { redactJmError } from '../model/jmBlacklist.js'
import { runCommand } from '../model/runCommand.js'

function failingNodeCommand(secret) {
  const script = `process.stderr.write('token=${secret}');process.exit(1)`
  return `"${process.execPath}" -e "${script}"`
}

test('redacts command errors before the first warning is logged', async () => {
  const warnings = []
  const result = await runCommand(failingNodeCommand('top-secret'), {
    redactError: redactJmError,
    logger: {
      debug() {},
      warn(message) {
        warnings.push(String(message))
      },
    },
  })

  assert.equal(result.failed, true)
  assert.match(result.err, /top-secret/)
  assert.doesNotMatch(warnings.join('\n'), /top-secret/)
  assert.match(warnings.join('\n'), /\[redacted\]/)
})

test('hides command errors when the configured redactor throws', async () => {
  const warnings = []
  await runCommand(failingNodeCommand('fallback-secret'), {
    redactError() {
      throw new Error('redactor failed')
    },
    logger: {
      debug() {},
      warn(message) {
        warnings.push(String(message))
      },
    },
  })

  assert.doesNotMatch(warnings.join('\n'), /fallback-secret/)
  assert.match(warnings.join('\n'), /错误详情已隐藏/)
})
