import path from 'node:path'

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
}

export function resolvePublicFile(rootDir, requestUrl) {
  if (typeof rootDir !== 'string' || typeof requestUrl !== 'string') {
    return null
  }

  const separatorIndex = requestUrl.search(/[?#]/)
  const rawPath =
    separatorIndex === -1 ? requestUrl : requestUrl.slice(0, separatorIndex)

  let decodedPath
  try {
    decodedPath = decodeURIComponent(rawPath || '/')
  } catch {
    return null
  }
  if (decodedPath.includes('\0')) return null

  const segments = decodedPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.')
  if (segments.some((segment) => segment === '..' || segment.includes(':'))) {
    return null
  }

  const root = path.resolve(rootDir)
  const relativePath =
    segments.length === 0 ? 'index.html' : path.join(...segments)
  if (path.isAbsolute(relativePath)) return null

  const filePath = path.resolve(root, relativePath)
  const relativeToRoot = path.relative(root, filePath)
  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null
  }
  return filePath
}

export function getContentType(filePath) {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ||
    'application/octet-stream'
  )
}
