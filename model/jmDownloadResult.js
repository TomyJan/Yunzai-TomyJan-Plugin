function normalizeOutput(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .trim()
}

function extractExceptionMessage(output) {
  const match = output.match(
    /jmcomic\.jm_exception\.[^\s(]+.*?,\s*[^\s(]+\s*\(([^)]+)\)/,
  )
  if (!match) return null

  let message = match[1].trim().replace(/^['"]|['"]$/g, '')
  try {
    const payload = JSON.parse(message)
    message = payload?.errorMsg || message
  } catch {
    // Plain-text exception messages are returned as-is.
  }
  return normalizeOutput(message)
}

export function classifyJmDownloadResult(commandResult) {
  const output = String(commandResult?.output || '')
  if (!output) {
    return {
      type: 'no_output',
      message: normalizeOutput(commandResult?.err) || '未知错误',
    }
  }

  if (output.includes('jmcomic.jm_exception')) {
    if (output.includes('请求的本子不存在')) {
      return { type: 'known_error', message: '此 ID 不存在或登录可见' }
    }
    const message = extractExceptionMessage(output)
    if (message) return { type: 'known_error', message }
    return { type: 'unknown_error', output: normalizeOutput(output) }
  }

  if (output.includes('本子下载完成')) return { type: 'success' }
  return { type: 'unknown_error', output: normalizeOutput(output) }
}
