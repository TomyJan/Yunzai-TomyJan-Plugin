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

const PROVIDER_NAMES = {
  c2pa: 'C2PA',
  openai: 'OpenAI',
  hive: 'Hive',
  sightengine: 'Sightengine',
}

const EXTERNAL_PROVIDERS = ['openai', 'hive', 'sightengine']
const NETWORK_ERROR_PATTERN =
  /(?:^|\b)(?:AbortError|TimeoutError|ECONN\w*|ENET\w*|EHOST\w*|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_\w+|fetch failed|socket|TLS|certificate)(?:\b|$)/i

function parseConfigArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function proxySecrets(pluginConfig) {
  const rawUrl = String(pluginConfig?.proxy?.url || '').trim()
  if (!rawUrl) return []
  const values = [rawUrl]
  try {
    const proxyUrl = new URL(rawUrl)
    for (const value of [proxyUrl.username, proxyUrl.password]) {
      if (!value) continue
      values.push(value)
      try {
        values.push(decodeURIComponent(value))
      } catch {
        // The encoded credential is still included in the redaction list.
      }
    }
  } catch {
    // The whole malformed URL is already included in the redaction list.
  }
  return values
}

function collectSecrets(pluginConfig) {
  const aiImageConfig = pluginConfig.aiImage || pluginConfig
  return [
    ...(aiImageConfig.openai?.apiKeys || []),
    ...(aiImageConfig.hive?.apiKeys || []),
    ...(aiImageConfig.sightengine?.credentials || []).flatMap((credential) => [
      credential?.apiUser,
      credential?.apiSecret,
    ]),
    ...proxySecrets(pluginConfig),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function redactLogValue(value, secrets = []) {
  const parts = []
  const visited = new Set()
  let current = value
  for (
    let depth = 0;
    current !== undefined && current !== null && depth < 5;
    depth += 1
  ) {
    if (typeof current === 'object') {
      if (visited.has(current)) break
      visited.add(current)
    }
    const message =
      current instanceof Error || typeof current?.message === 'string'
        ? current.message
        : String(current || '')
    if (message && !parts.includes(message)) parts.push(message)
    current = current?.cause
  }
  let message = parts.join(' <- ')
  for (const secret of secrets) {
    message = message.split(secret).join('[redacted]')
  }
  return message
    .replace(/https?:\/\/[^\s，。；]+/gi, '[redacted-url]')
    .replace(/Bearer\s+[^\s，。；]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?(?:key|secret|user))=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
}

export function redactAiImageError(error, pluginConfig = {}) {
  return redactLogValue(error, collectSecrets(pluginConfig)) || '未知错误'
}

function writeLog(logger, level, message) {
  logger?.[level]?.(`[AI图片识别] ${message}`)
}

function debugField(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' || typeof value === 'boolean') return value
  return String(value).slice(0, 120)
}

function providerDebugDetails(result, secrets) {
  const details = {
    status: debugField(result.status),
    reason: debugField(result.reason),
    httpStatus: debugField(result.httpStatus),
    attempts: debugField(result.attempts),
    credentialCount: debugField(result.credentialCount),
    errorCodes: Array.isArray(result.errorCodes)
      ? result.errorCodes.map(debugField)
      : undefined,
  }
  const evidence = result.evidence || {}

  if (result.provider === 'c2pa') {
    Object.assign(details, {
      aiGenerated: debugField(evidence.aiGenerated),
      validationState: debugField(evidence.validationState),
      issuer: debugField(evidence.issuer),
      claimGenerator: debugField(evidence.claimGenerator),
    })
  } else if (result.provider === 'openai') {
    details.signals = Array.isArray(result.signals)
      ? result.signals.map((signal) => ({
          type: debugField(signal.type),
          outcome: debugField(signal.outcome),
          validationState: debugField(signal.validationState),
          model: debugField(signal.model),
        }))
      : []
  } else if (result.provider === 'hive') {
    Object.assign(details, {
      aiGeneratedProbability: debugField(evidence.aiGeneratedProbability),
      generator: debugField(evidence.generator),
      generatorProbability: debugField(evidence.generatorProbability),
      deepfakeProbability: debugField(evidence.deepfakeProbability),
    })
  } else if (result.provider === 'sightengine') {
    details.aiGeneratedProbability = debugField(evidence.aiGeneratedProbability)
  }

  if (result.error) details.error = debugField(result.error)
  return redactLogValue(JSON.stringify(details), secrets)
}

function providerAttemptDetail(result) {
  const attempts = Number(result.attempts)
  const credentialCount = Number(result.credentialCount)
  if (
    !Number.isInteger(attempts) ||
    !Number.isInteger(credentialCount) ||
    credentialCount <= 0
  ) {
    return ''
  }
  return `尝试 ${attempts}/${credentialCount}`
}

function providerErrorDetail(result, secrets) {
  const message =
    result.reason || redactLogValue(result.error, secrets) || '未知错误'
  const context = []
  const errorCodes = Array.isArray(result.errorCodes)
    ? [...new Set(result.errorCodes.map(debugField).filter(Boolean))]
    : []
  if (errorCodes.length > 0) context.push(`错误码 ${errorCodes.join('/')}`)
  const attempt = providerAttemptDetail(result)
  if (attempt) context.push(attempt)
  return context.length > 0 ? `${message}（${context.join('；')}）` : message
}

function isNetworkFailure(result) {
  if (result.status !== 'error') return false
  const values = [
    ...(Array.isArray(result.errorCodes) ? result.errorCodes : []),
    result.error,
  ]
  return values.some((value) => NETWORK_ERROR_PATTERN.test(String(value || '')))
}

function logSharedProxyFailure(logger, results, proxyState) {
  if (!proxyState.configured) return
  const externalResults = results.filter((result) =>
    EXTERNAL_PROVIDERS.includes(result.provider),
  )
  if (externalResults.length < 2 || !externalResults.every(isNetworkFailure)) {
    return
  }
  const providers = externalResults
    .map(({ provider }) => PROVIDER_NAMES[provider] || provider)
    .join('、')
  const errorCodes = [
    ...new Set(externalResults.flatMap((result) => result.errorCodes || [])),
  ]
  const codeSummary = errorCodes.length > 0 ? `（${errorCodes.join('/')}）` : ''
  writeLog(
    logger,
    'warn',
    `疑似代理链路异常: ${providers} 均发生网络错误${codeSummary}，代理=${proxyState.target}；请检查代理服务是否监听、Bot 或容器到代理地址是否可达，以及代理协议是否为 HTTP/HTTPS`,
  )
}

function elapsedMs(now, startedAt) {
  return Math.max(0, Math.round(now() - startedAt))
}

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

function getEnabledProviders(aiImageConfig) {
  return [
    aiImageConfig.c2pa?.enable !== false && 'c2pa',
    aiImageConfig.openai?.enable !== false && 'openai',
    aiImageConfig.hive?.enable !== false && 'hive',
    aiImageConfig.sightengine?.enable === true && 'sightengine',
  ].filter(Boolean)
}

function getProxyLogState(pluginConfig, enabled) {
  if (!enabled) {
    return { configured: false, label: '关闭（API 直连）' }
  }
  const rawUrl = String(pluginConfig?.proxy?.url || '').trim()
  if (!rawUrl) {
    return {
      configured: false,
      label: '启用但未配置地址（API 直连）',
    }
  }
  try {
    const proxyUrl = new URL(rawUrl)
    if (!proxyUrl.host || !['http:', 'https:'].includes(proxyUrl.protocol)) {
      return {
        configured: false,
        label: `启用但协议不受支持（${proxyUrl.protocol || '未知协议'}）`,
      }
    }
    const target = `${proxyUrl.protocol}//${proxyUrl.host}`
    return {
      configured: true,
      target,
      label: `启用（${target}）`,
    }
  } catch {
    return {
      configured: false,
      label: '启用但地址格式无效',
    }
  }
}

function formatFileSizeLimit(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${bytes} B`
}

function providerCredentialCount(provider, aiImageConfig) {
  if (provider === 'openai') {
    return parseConfigArray(aiImageConfig.openai?.apiKeys).length
  }
  if (provider === 'hive') {
    return parseConfigArray(aiImageConfig.hive?.apiKeys).length
  }
  if (provider === 'sightengine') {
    return parseConfigArray(aiImageConfig.sightengine?.credentials).length
  }
  return 0
}

function formatCredentialSummary(enabledProviders, aiImageConfig) {
  const entries = enabledProviders
    .filter((provider) => EXTERNAL_PROVIDERS.includes(provider))
    .map(
      (provider) =>
        `${PROVIDER_NAMES[provider]} ${providerCredentialCount(provider, aiImageConfig)}`,
    )
  return entries.length > 0 ? entries.join('、') : '无'
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
    const response = await fetchImpl(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(getTimeoutMs(options)),
    })
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

async function providerCall(provider, fn, context = {}) {
  const { logger, now = Date.now, secrets = [] } = context
  const name = PROVIDER_NAMES[provider] || provider
  const startedAt = now()
  writeLog(logger, 'info', `${name} 开始检测`)
  let result
  try {
    result = await Promise.resolve().then(fn)
  } catch (error) {
    result = {
      provider,
      status: 'error',
      error: redactLogValue(error, secrets),
      evidence: {},
      signals: [],
    }
  }

  const duration = elapsedMs(now, startedAt)
  writeLog(
    logger,
    'debug',
    `${name} 结果: ${providerDebugDetails(result, secrets)}`,
  )
  if (result.status === 'unavailable') {
    const baseDetail = result.httpStatus
      ? `HTTP ${result.httpStatus}`
      : result.reason || redactLogValue(result.error, secrets) || '未知原因'
    const attempt = providerAttemptDetail(result)
    const detail = attempt ? `${baseDetail}（${attempt}）` : baseDetail
    writeLog(logger, 'warn', `${name} 不可用: ${detail}，耗时 ${duration} ms`)
  } else if (result.status === 'error') {
    const detail = providerErrorDetail(result, secrets)
    writeLog(
      logger,
      'error',
      `${name} 检测失败: ${detail}，耗时 ${duration} ms`,
    )
  } else {
    const attempt = providerAttemptDetail(result)
    const status = attempt ? `${result.status}（${attempt}）` : result.status
    writeLog(logger, 'info', `${name} 检测完成: ${status}，耗时 ${duration} ms`)
  }
  return result
}

export async function inspectAiImage(
  imageUrl,
  pluginConfig = {},
  dependencies = {},
) {
  const aiImageConfig = pluginConfig.aiImage || pluginConfig
  const logger = dependencies.logger
  const now = dependencies.now || Date.now
  const secrets = collectSecrets(pluginConfig)
  const inspectionStartedAt = now()
  const timeoutMs = getTimeoutMs(aiImageConfig)
  const maxFileSize = getMaxFileSize(aiImageConfig)
  const enabledProviders = getEnabledProviders(aiImageConfig)
  const proxyState = getProxyLogState(
    pluginConfig,
    aiImageConfig.proxy?.enable === true,
  )
  writeLog(
    logger,
    'info',
    `开始检测: 渠道=${enabledProviders.map((provider) => PROVIDER_NAMES[provider]).join('、') || '无'}；图片下载=直连；API 代理=${proxyState.label}；超时=${timeoutMs} ms；大小限制=${formatFileSizeLimit(maxFileSize)}；凭据=${formatCredentialSummary(enabledProviders, aiImageConfig)}`,
  )
  if (enabledProviders.length === 0) {
    writeLog(logger, 'warn', '未启用任何检测渠道，跳过图片下载')
    return summarizeAiImageResults([], { noProvidersEnabled: true })
  }
  const downloadOptions = {
    ...dependencies,
    timeoutMs,
    maxFileSize,
  }
  const downloadStartedAt = now()
  let image
  try {
    image = await downloadImage(imageUrl, downloadOptions)
  } catch (error) {
    const safeMessage = redactAiImageError(error, pluginConfig)
    writeLog(
      logger,
      'error',
      `图片下载失败: ${safeMessage}，总耗时 ${elapsedMs(now, inspectionStartedAt)} ms`,
    )
    throw new Error(safeMessage, { cause: error })
  }
  writeLog(
    logger,
    'info',
    `图片下载完成: ${image.mimeType}，${image.buffer.length} 字节，耗时 ${elapsedMs(now, downloadStartedAt)} ms`,
  )
  const providerOptions = {
    ...downloadOptions,
    pluginConfig,
    proxyEnabled: aiImageConfig.proxy?.enable === true,
    timeoutMs,
    mimeType: image.mimeType,
    imageUrl,
  }
  const tasks = []
  if (aiImageConfig.c2pa?.enable !== false) {
    tasks.push(
      providerCall(
        'c2pa',
        () =>
          checkC2pa(image.buffer, {
            ...dependencies,
            ...aiImageConfig.c2pa,
            timeoutMs,
            mimeType: image.mimeType,
          }),
        { logger, now, secrets },
      ),
    )
  }
  if (aiImageConfig.openai?.enable !== false) {
    tasks.push(
      providerCall(
        'openai',
        () =>
          checkOpenAi(image.buffer, {
            ...providerOptions,
            ...aiImageConfig.openai,
          }),
        { logger, now, secrets },
      ),
    )
  }
  if (aiImageConfig.hive?.enable !== false) {
    tasks.push(
      providerCall(
        'hive',
        () =>
          checkHive(image.buffer, {
            ...providerOptions,
            ...aiImageConfig.hive,
          }),
        { logger, now, secrets },
      ),
    )
  }
  if (aiImageConfig.sightengine?.enable === true) {
    tasks.push(
      providerCall(
        'sightengine',
        () =>
          checkSightengine(image.buffer, {
            ...providerOptions,
            ...aiImageConfig.sightengine,
          }),
        { logger, now, secrets },
      ),
    )
  }
  const results = await Promise.all(tasks)
  logSharedProxyFailure(logger, results, proxyState)
  const summary = summarizeAiImageResults(results)
  writeLog(
    logger,
    'info',
    `检测汇总: ${summary.verdict}，可信度 ${summary.confidence}，总耗时 ${elapsedMs(now, inspectionStartedAt)} ms`,
  )
  return {
    ...summary,
    image: { mimeType: image.mimeType, size: image.buffer.length },
  }
}

export { downloadImage }
