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
