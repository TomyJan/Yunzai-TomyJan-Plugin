const IMAGE_URL_KEYS = ['url', 'file', 'path']

function getImageUrl(segment) {
  for (const key of IMAGE_URL_KEYS) {
    const value = segment[key] ?? segment.data?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

export function getImageUrlsFromMessage(message) {
  const urls = []

  function collect(value) {
    if (Array.isArray(value)) {
      for (const item of value) collect(item)
      return
    }
    if (!value || typeof value !== 'object') return
    if (value.type === 'image') {
      const url = getImageUrl(value)
      if (url) urls.push(url)
      return
    }
    if ('message' in value) collect(value.message)
    if ('raw_message' in value) collect(value.raw_message)
  }

  collect(message)
  return urls
}

function getEventMessage(event) {
  if (Array.isArray(event?.message)) return event.message
  if (event?.message && typeof event.message === 'object') return event.message
  return event?.raw_message
}

export function isAiImageCommand(message) {
  return /^#?ai图$/iu.test(String(message || '').trim())
}

function getReplySegment(event) {
  return Array.isArray(event?.message)
    ? event.message.find((segment) => segment?.type === 'reply')
    : undefined
}

async function getQuotedMessages(event) {
  const replySegment = getReplySegment(event)
  const hasReply = Boolean(event?.reply_id || event?.source || replySegment)

  if (hasReply && typeof event?.getReply === 'function') {
    try {
      const reply = await event.getReply()
      const urls = getImageUrlsFromMessage(reply)
      if (urls.length > 0) return urls
    } catch {
      // Adapter methods can coexist even when one does not support replies.
    }
  }

  const historyTarget = event?.group || event?.friend
  if (event?.source && typeof historyTarget?.getChatHistory === 'function') {
    try {
      const position = event.isGroup ? event.source.seq : event.source.time
      const history = await historyTarget.getChatHistory(position, 1)
      const urls = getImageUrlsFromMessage(history)
      if (urls.length > 0) return urls
    } catch {
      // Continue with the OneBot strategy when history lookup is unsupported.
    }
  }

  const messageId = replySegment?.id ?? replySegment?.data?.id
  if (messageId && typeof event?.bot?.sendApi === 'function') {
    try {
      const reply = await event.bot.sendApi('get_msg', {
        message_id: messageId,
      })
      return getImageUrlsFromMessage(reply?.data?.message ?? reply)
    } catch {
      return []
    }
  }

  return []
}

export async function extractImageUrls(event) {
  const currentUrls = getImageUrlsFromMessage(getEventMessage(event))
  if (currentUrls.length > 0) return [...new Set(currentUrls)]

  return [...new Set(await getQuotedMessages(event))]
}
