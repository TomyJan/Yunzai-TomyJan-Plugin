export const VV_SHUO_COMMAND_PATTERN =
  '^#?(?:[zZ]?[vV]{2}|张?维为)(?:([oO][lL]|在线|增强))?说?[：:]?(.*)$'

const commandRegex = new RegExp(VV_SHUO_COMMAND_PATTERN)

export function parseVvShuoRequest(message) {
  if (typeof message !== 'string') return null
  const match = commandRegex.exec(message.trim())
  if (!match) return null

  const mode = match[1] || ''
  return {
    content: match[2].trim(),
    enhanced: Boolean(mode),
    online: /^(?:ol|在线)$/i.test(mode),
  }
}

export function buildVvShuoSearchUrl({ content, enhanced, count = 2 }) {
  const pathname = enhanced ? '/enhancedsearch' : '/search'
  const url = new URL(pathname, 'https://api.zvv.quest')
  url.searchParams.set('q', content)
  url.searchParams.set('n', String(count))
  return url.toString()
}

export function normalizeVvShuoResponse(payload, { enhanced = false } = {}) {
  if (payload?.code !== 200) {
    const code = payload?.code ? `(${payload.code})` : ''
    throw new Error(
      `VV 说${enhanced ? '增强版' : ''}有问题${code}: ${payload?.msg || '但没说啥问题'}`,
    )
  }
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error('VV 好像没说过这个')
  }
  return payload.data
}
