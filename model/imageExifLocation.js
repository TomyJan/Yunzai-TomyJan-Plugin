import exifr from 'exifr'

import { sanitizeMessageText } from './imageExifPolicy.js'
import { withProxy } from './proxy.js'

const DEFAULT_TIMEOUT_MS = 10000
const REQUEST_INTERVAL_MS = 1000
const MAX_CACHE_ENTRIES = 500
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_PENDING_REQUESTS = 20
const USER_AGENT =
  'Yunzai-TomyJan-Plugin/EXIF-location (https://github.com/TomyJan/Yunzai-TomyJan-Plugin)'

function isValidCoordinate(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum
}

export async function extractGps(buffer, dependencies = {}) {
  const gpsReader = dependencies.gpsReader || exifr.gps
  try {
    const gps = await gpsReader(buffer)
    const latitude = gps?.latitude
    const longitude = gps?.longitude
    if (
      !isValidCoordinate(latitude, -90, 90) ||
      !isValidCoordinate(longitude, -180, 180)
    ) {
      return undefined
    }
    return { latitude, longitude }
  } catch {
    return undefined
  }
}

function firstAddressValue(address, keys) {
  for (const key of keys) {
    const value = sanitizeMessageText(address?.[key], 48)
    if (value) return value
  }
}

export function formatLocation(address) {
  const levels = [
    firstAddressValue(address, ['state', 'province', 'region']),
    firstAddressValue(address, ['city', 'municipality']),
    firstAddressValue(address, ['city_district', 'district', 'county']),
    firstAddressValue(address, [
      'town',
      'village',
      'suburb',
      'borough',
      'neighbourhood',
    ]),
  ]
  const unique = levels.filter(
    (value, index) => value && levels.indexOf(value) === index,
  )
  return unique.length > 0 ? unique.join('') : undefined
}

export function formatExifReply(
  location,
  name,
  honorific = '先生',
  attribution,
) {
  const safeLocation = sanitizeMessageText(location, 128) || ''
  const safeName = sanitizeMessageText(name, 32) || '朋友'
  const suffix = sanitizeMessageText(honorific, 16)
  const source = sanitizeMessageText(attribution, 80)
  const message = `请问是${safeLocation}的${safeName}${suffix ? ` ${suffix}` : ''}吗？`
  return source ? `${message}\n位置数据：${source}` : message
}

function getGeocodingConfig(pluginConfig) {
  return pluginConfig?.imageExif || pluginConfig || {}
}

function getTimeoutMs(config) {
  const timeoutMs = Number(config?.timeoutMs)
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, 60000)
    : DEFAULT_TIMEOUT_MS
}

function getHttpsEndpoint(config) {
  try {
    const value = String(config?.geocodingEndpoint || '').trim()
    if (!value) return undefined
    const endpoint = new URL(value)
    const hostname = endpoint.hostname.toLowerCase().replace(/\.$/u, '')
    if (
      endpoint.protocol !== 'https:' ||
      hostname === 'nominatim.openstreetmap.org'
    ) {
      return undefined
    }
    return endpoint
  } catch {
    return undefined
  }
}

function coordinateCacheKey(endpoint, gps) {
  return `${endpoint.href}|${gps.latitude.toFixed(5)},${gps.longitude.toFixed(5)}`
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createReverseGeocoder(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const now = dependencies.now || Date.now
  const sleep = dependencies.sleep || delay
  const setTimer = dependencies.setTimeoutImpl || setTimeout
  const clearTimer = dependencies.clearTimeoutImpl || clearTimeout
  const cache = new Map()
  let queue = Promise.resolve()
  let lastRequestAt
  let pendingRequests = 0

  function deleteCacheEntry(key, entry) {
    if (!entry || cache.get(key) !== entry) return
    cache.delete(key)
    if (entry.timer) clearTimer(entry.timer)
  }

  async function request(gps, pluginConfig, config, endpoint) {
    const elapsed =
      lastRequestAt === undefined ? Infinity : now() - lastRequestAt
    if (elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - Math.max(0, elapsed))
    }
    lastRequestAt = now()

    endpoint.searchParams.set('format', 'jsonv2')
    endpoint.searchParams.set('addressdetails', '1')
    endpoint.searchParams.set('accept-language', 'zh-CN')
    endpoint.searchParams.set('lat', String(gps.latitude))
    endpoint.searchParams.set('lon', String(gps.longitude))
    const init = withProxy(
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(getTimeoutMs(config)),
      },
      pluginConfig,
      config.proxy?.enable === true,
      {
        feature: '图片 EXIF 定位',
        proxyAgentFactory: dependencies.proxyAgentFactory,
        warn: dependencies.warn,
      },
    )
    const response = await fetchImpl(endpoint, init)
    if (!response?.ok) return undefined
    const body = await response.json()
    return body?.address &&
      typeof body.address === 'object' &&
      !Array.isArray(body.address)
      ? body.address
      : undefined
  }

  return async function reverseGeocode(gps, pluginConfig = {}) {
    if (
      !isValidCoordinate(gps?.latitude, -90, 90) ||
      !isValidCoordinate(gps?.longitude, -180, 180) ||
      typeof fetchImpl !== 'function'
    ) {
      return undefined
    }
    const config = getGeocodingConfig(pluginConfig)
    const endpoint = getHttpsEndpoint(config)
    if (!endpoint) return undefined
    const key = coordinateCacheKey(endpoint, gps)
    const cached = cache.get(key)
    if (cached) {
      if (cached.expiresAt > now()) return cached.pending
      deleteCacheEntry(key, cached)
    }
    if (pendingRequests >= MAX_PENDING_REQUESTS) return undefined
    pendingRequests += 1

    const pending = queue
      .catch(() => undefined)
      .then(() => request(gps, pluginConfig, config, endpoint))
      .catch(() => undefined)
    queue = pending.then(() => undefined)
    const entry = {
      pending,
      expiresAt: now() + CACHE_TTL_MS,
      timer: undefined,
    }
    entry.timer = setTimer(() => deleteCacheEntry(key, entry), CACHE_TTL_MS)
    entry.timer?.unref?.()
    cache.set(key, entry)
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value
      deleteCacheEntry(oldestKey, cache.get(oldestKey))
    }
    try {
      const address = await pending
      if (!address) deleteCacheEntry(key, entry)
      return address
    } finally {
      pendingRequests -= 1
    }
  }
}
