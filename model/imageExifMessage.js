import { downloadImage as defaultDownloadImage } from './aiImage.js'
import {
  createReverseGeocoder,
  extractGps as defaultExtractGps,
  formatExifReply,
  formatLocation,
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
    return { status: 'skipped', reason: 'busy' }
  }
  activeJobs += 1

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
      return { status: 'error', stage: 'download' }
    }

    let gps
    try {
      gps = await extractGps(image.buffer)
    } catch {
      return { status: 'error', stage: 'exif' }
    }
    if (!gps) return { status: 'skipped', reason: 'no_gps' }

    let address
    try {
      address = await reverseGeocode(gps, pluginConfig)
    } catch {
      return { status: 'error', stage: 'geocode' }
    }
    const location = formatLocation(address)
    if (!location) return { status: 'skipped', reason: 'no_location' }

    return {
      status: 'reply',
      message: formatExifReply(
        location,
        getSenderDisplayName(event),
        imageExifConfig.honorific,
        imageExifConfig.attribution,
      ),
    }
  } finally {
    activeJobs -= 1
  }
}
