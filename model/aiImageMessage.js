const IMAGE_URL_KEYS = ['url', 'file', 'path']

function asSegments(message) {
  if (Array.isArray(message)) return message
  if (message && typeof message === 'object') return [message]
  return []
}

export function getImageUrlsFromMessage(message) {
  const urls = []
  for (const segment of asSegments(message)) {
    if (!segment || typeof segment !== 'object' || segment.type !== 'image') {
      continue
    }
    for (const key of IMAGE_URL_KEYS) {
      const value = segment[key]
      if (typeof value === 'string' && value.trim()) {
        urls.push(value.trim())
        break
      }
    }
  }
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

export async function extractImageUrls(event) {
  const currentUrls = getImageUrlsFromMessage(getEventMessage(event))
  if (currentUrls.length > 0) return [...new Set(currentUrls)]

  if (!event?.source || typeof event.getReply !== 'function') return []

  const reply = await event.getReply()
  const replyMessage = reply?.message ?? reply?.raw_message ?? reply
  return [...new Set(getImageUrlsFromMessage(replyMessage))]
}
