function parseAllowedGroups(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value
      .split(/[\s,，]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

export function shouldInspectImageEvent(event, config = {}) {
  if (event?.isGroup === true || event?.group_id !== undefined) {
    const groupId = String(event?.group_id ?? '').trim()
    return parseAllowedGroups(config.allowedGroups).some(
      (allowed) => String(allowed).trim() === groupId,
    )
  }
  if (
    event?.isPrivate === true ||
    event?.message_type === 'private' ||
    event?.friend
  ) {
    return config.allowPrivate !== false
  }
  return false
}

export function sanitizeMessageText(value, maximumLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const normalized = String(value)
    .replace(/\[CQ:[^\]]*\]/giu, '')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return undefined
  return [...normalized].slice(0, maximumLength).join('')
}

export function getSenderDisplayName(event) {
  const candidates = [
    event?.sender?.card,
    event?.sender?.nickname,
    event?.nickname,
  ]
  for (const candidate of candidates) {
    const name = sanitizeMessageText(candidate, 32)
    if (name) return name
  }
  return '朋友'
}
