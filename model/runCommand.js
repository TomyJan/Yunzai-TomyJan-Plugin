import { exec } from 'node:child_process'
import { Buffer } from 'node:buffer'
import process from 'node:process'

import iconv from 'iconv-lite'

const isWindows = process.platform === 'win32'
const HIDDEN_ERROR_DETAIL = '错误详情已隐藏'

function decodeOutput(value) {
  if (isWindows && Buffer.isBuffer(value)) {
    return iconv.decode(value, 'gbk').trim()
  }
  return String(value ?? '').trim()
}

function redactErrorDetail(error, redactError) {
  if (typeof redactError !== 'function') return error
  try {
    const redacted = redactError(error)
    return typeof redacted === 'string' && redacted.trim()
      ? redacted.trim()
      : HIDDEN_ERROR_DETAIL
  } catch {
    return HIDDEN_ERROR_DETAIL
  }
}

/**
 * 执行命令。
 * @param {string} command 命令
 * @param {object} [options] 执行选项
 * @param {object} [options.logger] 日志对象
 * @param {(error: string) => string} [options.redactError] 日志错误脱敏器
 * @returns {Promise<{output: string, err: string, failed: boolean}>} 命令执行结果
 */
export async function runCommand(command, options = {}) {
  const { logger, redactError } = options
  const loggedCommand = redactErrorDetail(command, redactError)
  logger?.debug?.(`开始执行命令: ${loggedCommand}`)
  return await new Promise((resolve) => {
    exec(
      command,
      { encoding: isWindows ? 'buffer' : 'utf8' },
      (error, stdout, stderr) => {
        const output = decodeOutput(stdout)
        const err = decodeOutput(stderr)

        if (error) {
          logger?.warn?.(
            `执行命令 ${loggedCommand} 出错: ${redactErrorDetail(err, redactError)}`,
          )
        } else {
          logger?.debug?.(`执行命令 ${loggedCommand} 结果: ${output}`)
        }

        resolve({ output, err, failed: Boolean(error) })
      },
    )
  })
}
