export function normalizeJmAlbumId(value) {
  if (
    typeof value === 'number' &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    return null
  }
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  return text.replace(/^0+(?=\d)/, '')
}

function normalizeAuthorName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function parseJmvAuthors(output) {
  const match = String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:✍️?\s*)?作者\s*:\s*(.*)$/u))
    .find(Boolean)
  if (!match) throw new Error('无法解析 jmv 作者字段')

  const value = match[1].trim()
  if (!value || value === '未知') return []
  return value
    .replace(/\s+\.\.\.等\d+个$/, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function loadJmvAuthors({ albumId, optionPath, execute }) {
  const normalizedId = normalizeJmAlbumId(albumId)
  if (!normalizedId) throw new Error('无效的 JMComic ID')

  const result = await execute(
    `jmv ${normalizedId} --option="${optionPath}" --yes`,
  )
  if (result?.failed || !result?.output) {
    const detail = result?.err ? `: ${result.err}` : ''
    throw new Error(`jmv 查询失败${detail}`)
  }
  return parseJmvAuthors(result.output)
}

export async function checkJmBlacklists({
  albumId,
  albumIdBlacklist,
  authorNameBlacklist,
  loadAuthors,
}) {
  const normalizedId = normalizeJmAlbumId(albumId)
  if (albumIdBlacklist?.enable) {
    const blockedIds = new Set(
      (Array.isArray(albumIdBlacklist.ids) ? albumIdBlacklist.ids : [])
        .map(normalizeJmAlbumId)
        .filter(Boolean),
    )
    if (blockedIds.has(normalizedId)) {
      return { type: 'albumId', value: normalizedId }
    }
  }

  if (!authorNameBlacklist?.enable) return null
  const authors = await loadAuthors()
  const blockedAuthors = new Set(
    (Array.isArray(authorNameBlacklist.names) ? authorNameBlacklist.names : [])
      .map(normalizeAuthorName)
      .filter(Boolean),
  )
  const matched = authors.find((author) =>
    blockedAuthors.has(normalizeAuthorName(author)),
  )
  return matched ? { type: 'authorName', value: matched } : null
}
