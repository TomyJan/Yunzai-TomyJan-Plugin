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

export async function handleJmPdfUploadFailure(
  error,
  sendFilePolicy,
  event,
  { sendLink, logError },
) {
  const rawMessage =
    typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
        ? error.message
        : ''
  const isGroupSpaceFull = rawMessage === 'group space not enough'
  const message = isGroupSpaceFull
    ? '群文件空间不足'
    : rawMessage.includes('send feed not all success')
      ? '部分分片未发送成功'
      : rawMessage.includes('unknown highway error')
        ? '未知通道错误'
        : '未知错误'

  logError(`发送文件失败: ${message}`)
  const notice = `文件发送失败, 错误信息: \n${message}`
  if (sendFilePolicy !== 2 || isGroupSpaceFull) {
    await event.reply(notice, true)
    return
  }

  const sent = await event.reply(`${notice}\n将尝试上传到内置服务器...`, true)
  const link = await sendLink()
  const recall = event.isGroup
    ? event.group?.recallMsg
    : event.private?.recallMsg
  if (sent?.message_id != null && typeof recall === 'function') {
    try {
      await recall.call(
        event.isGroup ? event.group : event.private,
        sent.message_id,
      )
    } catch {
      // 撤回失败不应阻止临时链接送达。
    }
  }
  await event.reply(link, true)
}
