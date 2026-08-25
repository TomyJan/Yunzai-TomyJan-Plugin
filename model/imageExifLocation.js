import exifr from 'exifr'
import { fetch as undiciFetch } from 'undici'

import { sanitizeMessageText } from './imageExifPolicy.js'
import { withProxy } from './proxy.js'

const DEFAULT_TIMEOUT_MS = 10000
const REQUEST_INTERVAL_MS = 1000
const MAX_CACHE_ENTRIES = 500
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_PENDING_REQUESTS = 20
const DEFAULT_NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'
const AMAP_ENDPOINT = 'https://restapi.amap.com/v3/geocode/regeo'
const PROVIDER_ATTRIBUTIONS = {
  nominatim: '© OpenStreetMap contributors',
  amap: '高德开放平台',
}
const AMAP_RETRYABLE_CODES = new Set([
  '10001',
  '10002',
  '10003',
  '10004',
  '10005',
  '10006',
  '10007',
  '10008',
  '10009',
  '10010',
  '10012',
  '10013',
  '10014',
  '10015',
  '10016',
  '10019',
  '10020',
  '10021',
])
const USER_AGENT =
  'Yunzai-TomyJan-Plugin/EXIF-location (https://github.com/TomyJan/Yunzai-TomyJan-Plugin)'
const GCJ02_EARTH_RADIUS = 6378245
const GCJ02_ECCENTRICITY = 0.006693421622965943

function isValidCoordinate(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum
}

function safeNetworkReason(error) {
  const names = new Set()
  const codes = new Set()
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.name === 'string') names.add(current.name)
    if (typeof current.code === 'string') codes.add(current.code)
    current = current.cause
  }
  if (names.has('SyntaxError')) return '响应不是有效的 JSON'
  if (
    names.has('AbortError') ||
    names.has('TimeoutError') ||
    codes.has('ETIMEDOUT')
  ) {
    return '请求超时'
  }
  if (codes.has('UND_ERR_CONNECT_TIMEOUT')) return '连接超时'
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) return 'DNS 解析失败'
  if (codes.has('ECONNREFUSED')) return '连接被拒绝'
  if (codes.has('ECONNRESET')) return '连接被重置'
  if (
    [...codes].some((code) =>
      /^(?:CERT_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED_CERT)/u.test(code),
    )
  ) {
    return 'TLS 证书校验失败'
  }
  if ([...codes].some((code) => /PROXY/u.test(code))) return '代理连接失败'
  return '未知网络错误'
}

export async function extractGps(buffer, dependencies = {}) {
  const gpsReader = dependencies.gpsReader || exifr.gps
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

function getProvider(config) {
  return config?.provider === 'amap' ? 'amap' : 'nominatim'
}

export function getGeocodingAttribution(config = {}) {
  return (
    sanitizeMessageText(config.attribution, 80) ||
    PROVIDER_ATTRIBUTIONS[getProvider(config)]
  )
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
    const value = String(
      config?.geocodingEndpoint || DEFAULT_NOMINATIM_ENDPOINT,
    ).trim()
    const endpoint = new URL(value)
    if (endpoint.protocol !== 'https:') return undefined
    return endpoint
  } catch {
    return undefined
  }
}

function transformLatitude(longitude, latitude) {
  let result =
    -100 +
    2 * longitude +
    3 * latitude +
    0.2 * latitude * latitude +
    0.1 * longitude * latitude +
    0.2 * Math.sqrt(Math.abs(longitude))
  result +=
    ((20 * Math.sin(6 * longitude * Math.PI) +
      20 * Math.sin(2 * longitude * Math.PI)) *
      2) /
    3
  result +=
    ((20 * Math.sin(latitude * Math.PI) +
      40 * Math.sin((latitude / 3) * Math.PI)) *
      2) /
    3
  result +=
    ((160 * Math.sin((latitude / 12) * Math.PI) +
      320 * Math.sin((latitude * Math.PI) / 30)) *
      2) /
    3
  return result
}

function transformLongitude(longitude, latitude) {
  let result =
    300 +
    longitude +
    2 * latitude +
    0.1 * longitude * longitude +
    0.1 * longitude * latitude +
    0.1 * Math.sqrt(Math.abs(longitude))
  result +=
    ((20 * Math.sin(6 * longitude * Math.PI) +
      20 * Math.sin(2 * longitude * Math.PI)) *
      2) /
    3
  result +=
    ((20 * Math.sin(longitude * Math.PI) +
      40 * Math.sin((longitude / 3) * Math.PI)) *
      2) /
    3
  result +=
    ((150 * Math.sin((longitude / 12) * Math.PI) +
      300 * Math.sin((longitude / 30) * Math.PI)) *
      2) /
    3
  return result
}

function wgs84ToGcj02(gps) {
  const { longitude, latitude } = gps
  if (
    longitude < 72.004 ||
    longitude > 137.8347 ||
    latitude < 0.8293 ||
    latitude > 55.8271
  ) {
    return gps
  }

  const latitudeOffset = transformLatitude(longitude - 105, latitude - 35)
  const longitudeOffset = transformLongitude(longitude - 105, latitude - 35)
  const radians = (latitude / 180) * Math.PI
  const magic = 1 - GCJ02_ECCENTRICITY * Math.sin(radians) ** 2
  const rootMagic = Math.sqrt(magic)
  return {
    latitude:
      latitude +
      (latitudeOffset * 180) /
        (((GCJ02_EARTH_RADIUS * (1 - GCJ02_ECCENTRICITY)) /
          (magic * rootMagic)) *
          Math.PI),
    longitude:
      longitude +
      (longitudeOffset * 180) /
        ((GCJ02_EARTH_RADIUS / rootMagic) * Math.cos(radians) * Math.PI),
  }
}

function coordinateCacheKey(provider, endpoint, gps) {
  return `${provider}|${endpoint.href}|${gps.latitude.toFixed(5)},${gps.longitude.toFixed(5)}`
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createReverseGeocoder(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || undiciFetch
  const now = dependencies.now || Date.now
  const sleep = dependencies.sleep || delay
  const setTimer = dependencies.setTimeoutImpl || setTimeout
  const clearTimer = dependencies.clearTimeoutImpl || clearTimeout
  const logger = dependencies.logger || {}
  const cache = new Map()
  let queue = Promise.resolve()
  let lastRequestAt
  let pendingRequests = 0
  let amapKeyIndex = 0

  function log(level, message) {
    try {
      if (typeof logger[level] === 'function') logger[level](message)
      else if (level === 'warn' && typeof dependencies.warn === 'function') {
        dependencies.warn(message)
      }
    } catch {
      // Logging must never break image processing.
    }
  }

  function deleteCacheEntry(key, entry) {
    if (!entry || cache.get(key) !== entry) return
    cache.delete(key)
    if (entry.timer) clearTimer(entry.timer)
  }

  async function waitForNominatim() {
    const elapsed =
      lastRequestAt === undefined ? Infinity : now() - lastRequestAt
    if (elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - Math.max(0, elapsed))
    }
    lastRequestAt = now()
  }

  function requestInit(pluginConfig, config) {
    return withProxy(
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
        warn: (message) => log('warn', message),
      },
    )
  }

  async function requestNominatim(gps, pluginConfig, config, endpoint) {
    await waitForNominatim()

    endpoint.searchParams.set('format', 'jsonv2')
    endpoint.searchParams.set('addressdetails', '1')
    endpoint.searchParams.set('accept-language', 'zh-CN')
    endpoint.searchParams.set('lat', String(gps.latitude))
    endpoint.searchParams.set('lon', String(gps.longitude))
    const startedAt = now()
    log('debug', '正在请求 Nominatim 反向地理编码服务（第 1 次尝试）')
    try {
      const response = await fetchImpl(
        endpoint,
        requestInit(pluginConfig, config),
      )
      if (!response?.ok) {
        log(
          'warn',
          `Nominatim 请求失败，HTTP 状态码：${Number(response?.status) || 0}`,
        )
        return undefined
      }
      const body = await response.json()
      const address =
        body?.address &&
        typeof body.address === 'object' &&
        !Array.isArray(body.address)
          ? body.address
          : undefined
      if (!address) {
        log('warn', 'Nominatim 返回成功响应，但其中没有可用的地址信息')
        return undefined
      }
      log(
        'info',
        `Nominatim 位置查询成功，HTTP 状态码：${Number(response.status) || 200}，耗时：${Math.max(0, now() - startedAt)} ms`,
      )
      return address
    } catch (error) {
      log(
        'error',
        `Nominatim 请求失败：${safeNetworkReason(error)}，耗时：${Math.max(0, now() - startedAt)} ms`,
      )
      return undefined
    }
  }

  function normalizeAmapAddress(body) {
    const address = body?.regeocode?.addressComponent
    if (!address || typeof address !== 'object' || Array.isArray(address)) {
      return undefined
    }
    const text = (value) =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined
    const normalized = {
      province: text(address.province),
      city: text(address.city),
      district: text(address.district),
      town: text(address.township),
    }
    return Object.values(normalized).some(Boolean) ? normalized : undefined
  }

  function getAmapKeys(config) {
    if (!Array.isArray(config?.amap?.apiKeys)) return []
    return [
      ...new Set(
        config.amap.apiKeys
          .filter((key) => typeof key === 'string')
          .map((key) => key.trim())
          .filter(Boolean),
      ),
    ]
  }

  async function requestAmap(gps, pluginConfig, config) {
    const keys = getAmapKeys(config)
    if (keys.length === 0) {
      log('warn', '未配置高德 Web 服务 Key，无法查询图片位置')
      return undefined
    }
    const startIndex = amapKeyIndex % keys.length
    amapKeyIndex = (amapKeyIndex + 1) % keys.length

    const amapGps = wgs84ToGcj02(gps)
    const location = `${amapGps.longitude.toFixed(6)},${amapGps.latitude.toFixed(6)}`
    for (let offset = 0; offset < keys.length; offset += 1) {
      const attempt = offset + 1
      const endpoint = new URL(AMAP_ENDPOINT)
      endpoint.searchParams.set(
        'key',
        keys[(startIndex + offset) % keys.length],
      )
      endpoint.searchParams.set('location', location)
      endpoint.searchParams.set('output', 'json')
      endpoint.searchParams.set('extensions', 'base')
      const startedAt = now()
      log(
        'debug',
        `正在请求高德反向地理编码服务（第 ${attempt} 次尝试，共配置 ${keys.length} 个 Key）`,
      )
      try {
        const response = await fetchImpl(
          endpoint,
          requestInit(pluginConfig, config),
        )
        if (!response?.ok) {
          const status = Number(response?.status) || 0
          log(
            'warn',
            `高德请求失败，HTTP 状态码：${status}，当前为第 ${attempt} 次尝试`,
          )
          if ([401, 403, 429].includes(status)) continue
          return undefined
        }
        const body = await response.json()
        if (body?.status === '1') {
          const address = normalizeAmapAddress(body)
          if (!address) {
            log('warn', '高德返回成功响应，但其中没有可用的地址信息')
            return undefined
          }
          log(
            'info',
            `高德位置查询成功，HTTP 状态码：${Number(response.status) || 200}，第 ${attempt} 次尝试，耗时：${Math.max(0, now() - startedAt)} ms`,
          )
          return address
        }
        const rawApiCode = String(body?.infocode || '')
        const apiCode = /^\d{5}$/u.test(rawApiCode) ? rawApiCode : 'unknown'
        log(
          'warn',
          apiCode === 'unknown'
            ? `高德返回了无法识别的错误码，当前为第 ${attempt} 次尝试`
            : `高德请求失败，错误码：${apiCode}，当前为第 ${attempt} 次尝试`,
        )
        if (!AMAP_RETRYABLE_CODES.has(apiCode)) return undefined
      } catch (error) {
        log(
          'error',
          `高德请求失败：${safeNetworkReason(error)}，第 ${attempt} 次尝试，耗时：${Math.max(0, now() - startedAt)} ms`,
        )
        return undefined
      }
    }
    return undefined
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
    const provider = getProvider(config)
    const endpoint =
      provider === 'amap' ? new URL(AMAP_ENDPOINT) : getHttpsEndpoint(config)
    if (!endpoint) {
      log(
        'warn',
        `${provider === 'amap' ? '高德' : 'Nominatim'} 位置服务地址无效，已停止查询`,
      )
      return undefined
    }
    if (provider === 'amap' && getAmapKeys(config).length === 0) {
      log('warn', '未配置高德 Web 服务 Key，无法查询图片位置')
      return undefined
    }
    const key = coordinateCacheKey(provider, endpoint, gps)
    const cached = cache.get(key)
    if (cached) {
      if (cached.expiresAt > now()) {
        log(
          'debug',
          `已命中${provider === 'amap' ? '高德' : 'Nominatim'}位置缓存，无需再次请求服务`,
        )
        return cached.pending
      }
      deleteCacheEntry(key, cached)
    }
    if (pendingRequests >= MAX_PENDING_REQUESTS) {
      log(
        'warn',
        `${provider === 'amap' ? '高德' : 'Nominatim'}位置查询队列已满，本次停止查询`,
      )
      return undefined
    }
    pendingRequests += 1
    log(
      'debug',
      `已将${provider === 'amap' ? '高德' : 'Nominatim'}位置查询加入队列，当前等待或处理中：${pendingRequests} 项`,
    )

    const pending = queue
      .catch(() => undefined)
      .then(() =>
        provider === 'amap'
          ? requestAmap(gps, pluginConfig, config)
          : requestNominatim(gps, pluginConfig, config, endpoint),
      )
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
