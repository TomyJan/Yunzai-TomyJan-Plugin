import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import net from 'node:net'

import {
  checkC2pa,
  checkHive,
  checkOpenAi,
  checkSightengine,
  summarizeAiImageResults,
} from './aiImageProviders.js'
import { withProxy } from './proxy.js'

function getTimeoutMs(options) {
  const timeoutMs = Number(options?.timeoutMs)
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000
}

function getMaxFileSize(options) {
  const maxFileSize = Number(options?.maxFileSize)
  return Number.isFinite(maxFileSize) && maxFileSize > 0
    ? maxFileSize
    : 50 * 1024 * 1024
}

function guessMimeType(url, response) {
  const contentType = response?.headers?.get?.('content-type') || ''
  if (/^image\/(png|jpeg|webp)$/i.test(contentType.split(';')[0].trim())) {
    return contentType.split(';')[0].trim().toLowerCase()
  }
  const extension = String(url).split('?')[0].split('.').pop()?.toLowerCase()
  return {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }[extension]
}

function isPrivateAddress(address) {
  const family = net.isIP(address)
  if (family === 4) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  if (family === 6) {
    const normalized = address.toLowerCase()
    const [head, tail = ''] = normalized.split('::')
    const headGroups = head ? head.split(':') : []
    const tailGroups = tail ? tail.split(':') : []
    const groups = [
      ...headGroups,
      ...Array(8 - headGroups.length - tailGroups.length).fill('0'),
      ...tailGroups,
    ].map((group) => Number.parseInt(group || '0', 16))
    if (
      groups.length === 8 &&
      groups.slice(0, 5).every((group) => group === 0) &&
      groups[5] === 0xffff
    ) {
      const mappedIpv4 = [
        groups[6] >> 8,
        groups[6] & 0xff,
        groups[7] >> 8,
        groups[7] & 0xff,
      ].join('.')
      return isPrivateAddress(mappedIpv4)
    }
    const firstGroup = Number.parseInt(normalized.split(':')[0] || '0', 16)
    return (
      normalized === '::' ||
      normalized === '::1' ||
      (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) ||
      (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) ||
      (firstGroup >= 0xff00 && firstGroup <= 0xffff)
    )
  }
  return true
}

async function validateRemoteUrl(rawUrl, options = {}) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('图片地址无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 HTTP/HTTPS 图片地址')
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('不允许访问本机地址')
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await (options.resolveHost || dns.lookup)(hostname, {
        all: true,
        verbatim: true,
      })
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error('不允许访问内网地址')
  }
  return parsed
}

async function readResponseBuffer(response, maxFileSize) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxFileSize) throw new Error('图片超过大小限制')
    return buffer
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxFileSize) {
        await reader.cancel()
        throw new Error('图片超过大小限制')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks, total)
}

async function downloadImage(url, options = {}) {
  if (typeof options.downloadImpl === 'function') {
    const image = await options.downloadImpl(url, options)
    if (
      !image?.buffer ||
      !/^image\/(png|jpeg|webp)$/i.test(image.mimeType || '')
    ) {
      throw new Error('仅支持 PNG、JPEG、WebP 图片')
    }
    if (
      !Buffer.isBuffer(image.buffer) &&
      !(image.buffer instanceof Uint8Array)
    ) {
      throw new Error('下载结果不是有效图片数据')
    }
    if (image.buffer.byteLength > getMaxFileSize(options))
      throw new Error('图片超过大小限制')
    return {
      buffer: Buffer.from(image.buffer),
      mimeType: image.mimeType.toLowerCase(),
    }
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function')
    throw new Error('当前 Node 环境没有可用的 fetch')
  let currentUrl = await validateRemoteUrl(url, options)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(
      currentUrl,
      withProxy(
        {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(getTimeoutMs(options)),
        },
        options.pluginConfig,
        options.proxyEnabled,
        {
          feature: 'AI 图片识别',
          proxyAgentFactory: options.proxyAgentFactory,
          warn: options.warn,
        },
      ),
    )
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) throw new Error('图片重定向次数过多')
      const location = response.headers?.get?.('location')
      if (!location) throw new Error('图片重定向地址缺失')
      currentUrl = await validateRemoteUrl(
        new URL(location, currentUrl).href,
        options,
      )
      continue
    }
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`)
    const contentLength = Number(response.headers?.get?.('content-length'))
    if (
      Number.isFinite(contentLength) &&
      contentLength > getMaxFileSize(options)
    ) {
      throw new Error('图片超过大小限制')
    }
    const buffer = await readResponseBuffer(response, getMaxFileSize(options))
    const mimeType = guessMimeType(currentUrl, response)
    if (!mimeType) throw new Error('仅支持 PNG、JPEG、WebP 图片')
    return { buffer, mimeType }
  }
  throw new Error('图片下载失败')
}

function providerCall(provider, fn) {
  return Promise.resolve()
    .then(fn)
    .catch((error) => ({
      provider,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      evidence: {},
      signals: [],
    }))
}

export async function inspectAiImage(
  imageUrl,
  pluginConfig = {},
  dependencies = {},
) {
  const aiImageConfig = pluginConfig.aiImage || pluginConfig
  const proxyEnabled = aiImageConfig.proxy?.enable === true
  const sharedOptions = {
    ...dependencies,
    pluginConfig,
    proxyEnabled,
    timeoutMs: getTimeoutMs(aiImageConfig),
    maxFileSize: getMaxFileSize(aiImageConfig),
  }
  const image = await downloadImage(imageUrl, sharedOptions)
  const timeoutMs = getTimeoutMs(aiImageConfig)
  const providerOptions = {
    ...sharedOptions,
    timeoutMs,
    mimeType: image.mimeType,
    imageUrl,
  }
  const tasks = []
  if (aiImageConfig.c2pa?.enable !== false) {
    tasks.push(
      providerCall('c2pa', () =>
        checkC2pa(image.buffer, {
          ...dependencies,
          ...aiImageConfig.c2pa,
          timeoutMs,
          mimeType: image.mimeType,
        }),
      ),
    )
  }
  if (aiImageConfig.openai?.enable !== false) {
    tasks.push(
      providerCall('openai', () =>
        checkOpenAi(image.buffer, {
          ...providerOptions,
          ...aiImageConfig.openai,
        }),
      ),
    )
  }
  if (aiImageConfig.hive?.enable !== false) {
    tasks.push(
      providerCall('hive', () =>
        checkHive(image.buffer, { ...providerOptions, ...aiImageConfig.hive }),
      ),
    )
  }
  if (aiImageConfig.sightengine?.enable === true) {
    tasks.push(
      providerCall('sightengine', () =>
        checkSightengine(image.buffer, {
          ...providerOptions,
          ...aiImageConfig.sightengine,
        }),
      ),
    )
  }
  const results = await Promise.all(tasks)
  const summary = summarizeAiImageResults(results)
  return {
    ...summary,
    image: { mimeType: image.mimeType, size: image.buffer.length },
  }
}

export { downloadImage }
