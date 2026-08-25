import { downloadImage as defaultDownloadImage } from './aiImage.js'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createReverseGeocoder,
  extractGps as defaultExtractGps,
  formatExifReply,
  formatLocation,
} from './imageExifLocation.js'
import { getSenderDisplayName } from './imageExifPolicy.js'
import { getImageUrlsFromMessage } from './aiImageMessage.js'

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_CONCURRENT_JOBS = 2
const EXIF_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]
const defaultReverseGeocode = createReverseGeocoder()
let activeJobs = 0

function positiveLimit(value, fallback, maximum) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0
    ? Math.min(number, maximum)
    : fallback
}

function getCurrentImageUrls(event) {
  const messageUrls = getImageUrlsFromMessage(
    event?.message ?? event?.raw_message,
  ).filter((url) => /^https?:\/\//iu.test(url))
  if (messageUrls.length > 0) return messageUrls
  const eventImages = Array.isArray(event?.img) ? event.img : [event?.img]
  return [
    ...new Set(
      eventImages
        .filter((url) => typeof url === 'string')
        .map((url) => url.trim())
        .filter((url) => /^https?:\/\//iu.test(url)),
    ),
  ]
}

function collectMessageSegments(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectMessageSegments(item, result)
  } else if (value && typeof value === 'object') {
    if (typeof value.type === 'string') result.push(value)
    if ('message' in value) collectMessageSegments(value.message, result)
    if ('raw_message' in value)
      collectMessageSegments(value.raw_message, result)
  }
  return result
}

function getHeifFileCandidate(event) {
  for (const segment of collectMessageSegments(
    event?.message ?? event?.raw_message,
  )) {
    if (segment.type !== 'file') continue
    const data =
      segment.data && typeof segment.data === 'object'
        ? { ...segment, ...segment.data }
        : segment
    const fileName = [data.file_name, data.name, data.file].find(
      (value) =>
        typeof value === 'string' && /\.hei[cf](?:$|[?#])/iu.test(value),
    )
    if (!fileName) continue
    const url = [data.url, data.file_url, data.file].find(
      (value) =>
        typeof value === 'string' && /^https?:\/\//iu.test(value.trim()),
    )
    const fallbackFileId =
      typeof data.file === 'string' &&
      !/^https?:\/\//iu.test(data.file.trim()) &&
      !path.isAbsolute(data.file) &&
      !path.win32.isAbsolute(data.file)
        ? data.file.trim()
        : undefined
    const fileId = data.file_id ?? data.id ?? fallbackFileId
    return {
      fileId:
        typeof fileId === 'string' || typeof fileId === 'number'
          ? String(fileId)
          : undefined,
      url: typeof url === 'string' ? url.trim() : undefined,
      mimeType: /\.heif(?:$|[?#])/iu.test(fileName)
        ? 'image/heif'
        : 'image/heic',
    }
  }
}

function fileResolutionError(code) {
  return Object.assign(new Error('HEIF/HEIC 文件解析失败'), { code })
}

function unwrapFileResult(result) {
  return result?.data?.data ?? result?.data ?? result
}

async function withTimeout(operation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(fileResolutionError('EXIF_FILE_TIMEOUT')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function resolveHeifFile(event, candidate, options) {
  if (candidate.url) {
    return { kind: 'remote', url: candidate.url, mimeType: candidate.mimeType }
  }
  if (!candidate.fileId || typeof event?.bot?.sendApi !== 'function') {
    throw fileResolutionError('EXIF_FILE_UNAVAILABLE')
  }
  const result = await withTimeout(
    () =>
      event.bot.sendApi('get_file', {
        file_id: candidate.fileId,
      }),
    options.timeoutMs,
  )
  const data = unwrapFileResult(result)
  const remoteUrl = [data?.url, data?.file_url].find(
    (value) => typeof value === 'string' && /^https?:\/\//iu.test(value.trim()),
  )
  if (remoteUrl) {
    return {
      kind: 'remote',
      url: remoteUrl.trim(),
      mimeType: candidate.mimeType,
    }
  }

  const filePath = [data?.file, data?.file_path, data?.path].find(
    (value) =>
      typeof value === 'string' &&
      (path.isAbsolute(value) || path.win32.isAbsolute(value)),
  )
  if (!filePath) throw fileResolutionError('EXIF_FILE_UNAVAILABLE')
  const statFile = options.statFile || fs.stat
  const readFile = options.readFile || fs.readFile
  const stats = await withTimeout(() => statFile(filePath), options.timeoutMs)
  if (typeof stats?.isFile === 'function' && !stats.isFile()) {
    throw fileResolutionError('EXIF_FILE_UNAVAILABLE')
  }
  if (Number(stats?.size) > options.maxFileSize) {
    throw fileResolutionError('EXIF_FILE_TOO_LARGE')
  }
  const buffer = await withTimeout(() => readFile(filePath), options.timeoutMs)
  if (buffer.byteLength > options.maxFileSize) {
    throw fileResolutionError('EXIF_FILE_TOO_LARGE')
  }
  return {
    kind: 'local',
    image: {
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
      mimeType: candidate.mimeType,
    },
  }
}

function providerName(provider) {
  return provider === 'amap' ? '高德' : 'Nominatim'
}

function formatImageType(mimeType) {
  return (
    {
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/webp': 'WebP',
      'image/heic': 'HEIC',
      'image/heif': 'HEIF',
    }[mimeType] || '未知格式'
  )
}

function formatBytes(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 1024)
    return `${Math.max(0, size || 0)} B`
  return `${(size / 1024).toFixed(1)} KiB`
}

function safeInputFailure(error) {
  if (error?.code === 'EXIF_FILE_TOO_LARGE') return 'HEIF/HEIC 文件超过大小限制'
  if (error?.code === 'EXIF_FILE_TIMEOUT') return '读取 HEIF/HEIC 文件超时'
  if (error?.code === 'EXIF_FILE_UNAVAILABLE')
    return '无法取得 HEIF/HEIC 文件内容'
  if (/图片超过大小限制/u.test(error?.message || '')) return '图片超过大小限制'
  const status = /HTTP (\d{3})/u.exec(error?.message || '')?.[1]
  if (status) return `图片服务返回 HTTP ${status}`
  if (['AbortError', 'TimeoutError'].includes(error?.name))
    return '图片读取超时'
  return '图片读取失败'
}

function safeLog(logger, level, message) {
  try {
    logger?.[level]?.(message)
  } catch {
    // Logging must not change message handling.
  }
}

export async function processImageExifEvent(
  event,
  pluginConfig = {},
  dependencies = {},
) {
  const imageExifConfig = pluginConfig.imageExif || {}
  if (imageExifConfig.enable !== true) {
    return { status: 'skipped', reason: 'disabled' }
  }
  const imageUrl = getCurrentImageUrls(event)[0]
  const heifFile = imageUrl ? undefined : getHeifFileCandidate(event)
  if (!imageUrl && !heifFile) return { status: 'skipped', reason: 'no_image' }
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    safeLog(dependencies.logger, 'warn', '图片定位任务已满，本次暂不处理')
    return { status: 'skipped', reason: 'busy' }
  }
  activeJobs += 1
  const provider = imageExifConfig.provider === 'amap' ? 'amap' : 'nominatim'
  const now = dependencies.now || Date.now
  const startedAt = now()
  const timeoutMs = positiveLimit(
    imageExifConfig.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    60000,
  )
  const maxFileSize = positiveLimit(
    imageExifConfig.maxFileSize,
    DEFAULT_MAX_FILE_SIZE,
    100 * 1024 * 1024,
  )
  safeLog(
    dependencies.logger,
    'info',
    `开始处理图片定位，位置服务：${providerName(provider)}，消息来源：${heifFile ? 'HEIF/HEIC 文件' : '普通图片'}`,
  )
  safeLog(
    dependencies.logger,
    'debug',
    `图片定位任务已开始，当前正在处理 ${activeJobs} 个任务，大小限制：${formatBytes(maxFileSize)}，超时：${timeoutMs} ms`,
  )

  try {
    const downloadImage = dependencies.downloadImage || defaultDownloadImage
    const extractGps = dependencies.extractGps || defaultExtractGps
    const reverseGeocode = dependencies.reverseGeocode || defaultReverseGeocode
    let image
    const downloadStartedAt = now()
    try {
      const input = heifFile
        ? await resolveHeifFile(event, heifFile, {
            ...dependencies,
            maxFileSize,
            timeoutMs,
          })
        : { kind: 'remote', url: imageUrl }
      if (heifFile) {
        safeLog(
          dependencies.logger,
          'debug',
          input.kind === 'local'
            ? '已通过适配器取得 HEIF/HEIC 本地缓存文件'
            : '已取得 HEIF/HEIC 文件下载地址',
        )
      }
      image =
        input.kind === 'local'
          ? input.image
          : await downloadImage(input.url, {
              timeoutMs,
              maxFileSize,
              ...(heifFile
                ? {
                    allowedMimeTypes: EXIF_IMAGE_MIME_TYPES,
                    mimeTypeHint: input.mimeType,
                  }
                : {}),
            })
    } catch (error) {
      safeLog(
        dependencies.logger,
        'error',
        `无法读取待检查的图片：${safeInputFailure(error)}，耗时：${Math.max(0, now() - downloadStartedAt)} ms`,
      )
      return { status: 'error', stage: 'download' }
    }
    safeLog(
      dependencies.logger,
      'info',
      `图片下载完成，格式：${formatImageType(image.mimeType)}，大小：${formatBytes(image.buffer?.byteLength)}，耗时：${Math.max(0, now() - downloadStartedAt)} ms`,
    )

    let gps
    const exifStartedAt = now()
    try {
      gps = await extractGps(image.buffer)
    } catch {
      safeLog(
        dependencies.logger,
        'error',
        `读取图片 EXIF 失败，耗时：${Math.max(0, now() - exifStartedAt)} ms`,
      )
      return { status: 'error', stage: 'exif' }
    }
    if (!gps) {
      safeLog(
        dependencies.logger,
        'debug',
        `图片中没有可用的 GPS 信息，本次不查询位置，EXIF 处理耗时：${Math.max(0, now() - exifStartedAt)} ms`,
      )
      return { status: 'skipped', reason: 'no_gps' }
    }
    safeLog(
      dependencies.logger,
      'info',
      `已从图片中读取到 GPS 信息，准备使用 ${providerName(provider)} 查询位置，EXIF 处理耗时：${Math.max(0, now() - exifStartedAt)} ms`,
    )

    let address
    try {
      address = await reverseGeocode(gps, pluginConfig)
    } catch {
      safeLog(
        dependencies.logger,
        'error',
        `${providerName(provider)} 位置查询发生未处理异常，本次不发送回复`,
      )
      return { status: 'error', stage: 'geocode' }
    }
    const location = formatLocation(address)
    if (!location) {
      safeLog(
        dependencies.logger,
        'warn',
        `${providerName(provider)} 未返回可用位置，本次不发送回复`,
      )
      return { status: 'skipped', reason: 'no_location' }
    }

    safeLog(
      dependencies.logger,
      'info',
      `图片定位处理完成，准备发送回复，总耗时：${Math.max(0, now() - startedAt)} ms`,
    )

    return {
      status: 'reply',
      message: formatExifReply(
        location,
        getSenderDisplayName(event),
        imageExifConfig.honorific,
      ),
    }
  } finally {
    activeJobs -= 1
  }
}
