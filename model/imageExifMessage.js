import { downloadImage as defaultDownloadImage } from './aiImage.js'
import {
  createReverseGeocoder,
  extractGps as defaultExtractGps,
  formatExifReply,
  formatLocation,
  getGeocodingAttribution,
} from './imageExifLocation.js'
import {
  getSenderDisplayName,
  shouldInspectImageEvent,
} from './imageExifPolicy.js'
import { getImageUrlsFromMessage } from './aiImageMessage.js'

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_CONCURRENT_JOBS = 2
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
  if (!shouldInspectImageEvent(event, imageExifConfig)) {
    return { status: 'skipped', reason: 'scope' }
  }
  const imageUrl = getCurrentImageUrls(event)[0]
  if (!imageUrl) return { status: 'skipped', reason: 'no_image' }
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    safeLog(dependencies.logger, 'warn', 'workflow=skipped reason=busy')
    return { status: 'skipped', reason: 'busy' }
  }
  activeJobs += 1
  const provider = imageExifConfig.provider === 'amap' ? 'amap' : 'nominatim'
  const startedAt = Date.now()
  safeLog(dependencies.logger, 'info', `provider=${provider} workflow=started`)

  try {
    const downloadImage = dependencies.downloadImage || defaultDownloadImage
    const extractGps = dependencies.extractGps || defaultExtractGps
    const reverseGeocode = dependencies.reverseGeocode || defaultReverseGeocode
    let image
    try {
      image = await downloadImage(imageUrl, {
        timeoutMs: positiveLimit(
          imageExifConfig.timeoutMs,
          DEFAULT_TIMEOUT_MS,
          60000,
        ),
        maxFileSize: positiveLimit(
          imageExifConfig.maxFileSize,
          DEFAULT_MAX_FILE_SIZE,
          100 * 1024 * 1024,
        ),
      })
    } catch {
      safeLog(
        dependencies.logger,
        'warn',
        `provider=${provider} workflow=failed stage=download`,
      )
      return { status: 'error', stage: 'download' }
    }
    safeLog(
      dependencies.logger,
      'debug',
      `provider=${provider} stage=download status=succeeded`,
    )

    let gps
    try {
      gps = await extractGps(image.buffer)
    } catch {
      safeLog(
        dependencies.logger,
        'warn',
        `provider=${provider} workflow=failed stage=exif`,
      )
      return { status: 'error', stage: 'exif' }
    }
    if (!gps) {
      safeLog(
        dependencies.logger,
        'debug',
        `provider=${provider} workflow=skipped reason=no_gps`,
      )
      return { status: 'skipped', reason: 'no_gps' }
    }
    safeLog(
      dependencies.logger,
      'debug',
      `provider=${provider} stage=exif status=gps_found`,
    )

    let address
    try {
      address = await reverseGeocode(gps, pluginConfig)
    } catch {
      safeLog(
        dependencies.logger,
        'warn',
        `provider=${provider} workflow=failed stage=geocode`,
      )
      return { status: 'error', stage: 'geocode' }
    }
    const location = formatLocation(address)
    if (!location) {
      safeLog(
        dependencies.logger,
        'debug',
        `provider=${provider} workflow=skipped reason=no_location`,
      )
      return { status: 'skipped', reason: 'no_location' }
    }

    safeLog(
      dependencies.logger,
      'info',
      `provider=${provider} workflow=succeeded durationMs=${Math.max(0, Date.now() - startedAt)}`,
    )

    return {
      status: 'reply',
      message: formatExifReply(
        location,
        getSenderDisplayName(event),
        imageExifConfig.honorific,
        getGeocodingAttribution(imageExifConfig),
      ),
    }
  } finally {
    activeJobs -= 1
  }
}
