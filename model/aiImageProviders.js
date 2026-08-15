import { Buffer, File } from 'node:buffer'

import { fetch as undiciFetch, FormData as UndiciFormData } from 'undici'

import { withProxy } from './proxy.js'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/content_provenance_checks'
const HIVE_ENDPOINT =
  'https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection'
const SIGHTENGINE_ENDPOINT = 'https://api.sightengine.com/1.0/check.json'

const DEFAULT_TIMEOUT_MS = 15000
const keyRotation = new Map()

function parseArrayConfig(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return value
      .split(/\r?\n|,|，/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
}

function getApiKeys(options) {
  return [
    ...new Set(
      parseArrayConfig(options?.apiKeys)
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ]
}

function getCredentialPairs(options) {
  return parseArrayConfig(options?.credentials)
    .map((entry) => ({
      apiUser: String(entry?.apiUser || '').trim(),
      apiSecret: String(entry?.apiSecret || '').trim(),
    }))
    .filter((entry) => entry.apiUser && entry.apiSecret)
}

function nextRotation(provider, values) {
  const signature = JSON.stringify(values)
  const state = keyRotation.get(provider)
  const start = state?.signature === signature ? state.start : 0
  keyRotation.set(provider, {
    signature,
    start: (start + 1) % values.length,
  })
  return values.slice(start).concat(values.slice(0, start))
}

function requestInitWithProxy(init, options = {}) {
  return withProxy(init, options.pluginConfig, options.proxyEnabled, {
    feature: 'AI 图片识别',
    proxyAgentFactory: options.proxyAgentFactory,
    warn: options.warn,
  })
}

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  return Buffer.from(input || [])
}

function redactErrorText(value, secrets = []) {
  return secrets
    .map((secret) => String(secret || '').trim())
    .filter(Boolean)
    .reduce(
      (message, secret) => message.split(secret).join('[redacted]'),
      String(value || ''),
    )
    .replace(/https?:\/\/[^\s，。；]+/gi, '[redacted-url]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?(?:key|secret|user))=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
}

function proxySecrets(options = {}) {
  const rawUrl = String(options.pluginConfig?.proxy?.url || '').trim()
  if (!rawUrl) return []
  const secrets = [rawUrl]
  try {
    const proxyUrl = new URL(rawUrl)
    for (const value of [proxyUrl.username, proxyUrl.password]) {
      if (!value) continue
      secrets.push(value)
      try {
        secrets.push(decodeURIComponent(value))
      } catch {
        // The encoded value is still redacted when percent-decoding fails.
      }
    }
  } catch {
    // The whole malformed URL is already included in the redaction list.
  }
  return secrets
}

function errorDetails(error, secrets = []) {
  const parts = []
  const codes = []
  const visited = new Set()

  function collect(value, depth = 0) {
    if (value === undefined || value === null || depth > 4) return
    if (typeof value === 'object') {
      if (visited.has(value)) return
      visited.add(value)
    }

    const code =
      typeof value?.code === 'string' && value.code.trim()
        ? value.code.trim()
        : undefined
    if (code && !codes.includes(code)) codes.push(code)
    const name = typeof value?.name === 'string' ? value.name.trim() : ''
    if (/^(?:AbortError|TimeoutError)$/i.test(name) && !codes.includes(name)) {
      codes.push(name)
    }

    let message
    if (typeof value === 'string') message = value
    else if (typeof value?.message === 'string') message = value.message
    else if (code) {
      const address = String(value?.address || '').trim()
      const port = String(value?.port || '').trim()
      message = [code, address && `${address}${port ? `:${port}` : ''}`]
        .filter(Boolean)
        .join(' ')
    }
    if (
      message &&
      code &&
      !message.toUpperCase().includes(code.toUpperCase())
    ) {
      message = `${code}: ${message}`
    }
    if (message && !parts.includes(message)) parts.push(message)

    collect(value?.cause, depth + 1)
    if (Array.isArray(value?.errors)) {
      for (const nestedError of value.errors.slice(0, 4)) {
        collect(nestedError, depth + 1)
      }
    }
  }

  collect(error)
  const fallback = error instanceof Error ? error.message : String(error)
  return {
    message: redactErrorText(parts.join(' <- ') || fallback, secrets).slice(
      0,
      600,
    ),
    codes: codes.slice(0, 6),
  }
}

function safeError(error, secrets = []) {
  return errorDetails(error, secrets).message
}

function providerErrorDetails(error, credentialSecrets, options) {
  const secrets = [...credentialSecrets, ...proxySecrets(options)]
  const details = errorDetails(error, secrets)
  details.codes = details.codes.filter((code) => {
    const redacted = redactErrorText(code, secrets)
    return redacted === code && /^[a-z][a-z0-9_-]{0,63}$/i.test(code)
  })
  details.apiError = apiErrorSummary(error?.body, secrets)
  return details
}

function apiErrorSummary(body, secrets) {
  const errorObject =
    body?.error && typeof body.error === 'object' ? body.error : undefined
  const firstError = Array.isArray(body?.errors) ? body.errors[0] : undefined
  const sources = [errorObject, firstError, body].filter(
    (value) => value && typeof value === 'object',
  )
  const scalarText = (value) =>
    typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : ''
  const code = sources
    .map((value) => scalarText(value.code) || scalarText(value.type))
    .find(Boolean)
  const message =
    sources
      .map((value) => scalarText(value.message) || scalarText(value.detail))
      .find(Boolean) || scalarText(body?.error)
  const summary = [code && `[${code}]`, message].filter(Boolean).join(' ')
  return redactErrorText(summary, secrets).slice(0, 300) || undefined
}

function getTimeoutSignal(timeoutMs, signal) {
  if (signal) return signal
  if (typeof AbortSignal?.timeout === 'function') {
    return AbortSignal.timeout(Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  return controller.signal
}

function withTimeout(promise, timeoutMs) {
  const duration = Number(timeoutMs) || DEFAULT_TIMEOUT_MS
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('检测渠道请求超时')), duration)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function fetchJson(fetchImpl, url, init, timeoutMs) {
  const { proxyOptions, ...requestInit } = init
  const response = await fetchImpl(url, {
    ...requestInitWithProxy(requestInit, proxyOptions),
    signal: getTimeoutSignal(timeoutMs, init.signal),
  })
  let body
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }
  return body || {}
}

function toActions(active) {
  const actions = []
  const assertions = active?.assertions
  const list = Array.isArray(assertions)
    ? assertions
    : assertions && typeof assertions === 'object'
      ? Object.values(assertions)
      : []
  for (const assertion of list) {
    const data = assertion?.data ?? assertion
    const values = Array.isArray(data?.actions)
      ? data.actions
      : Array.isArray(data)
        ? data
        : []
    for (const action of values) {
      const name = typeof action === 'string' ? action : action?.action
      if (typeof name === 'string' && name && !actions.includes(name)) {
        actions.push(name)
      }
    }
  }
  return actions
}

function isAiSourceType(value) {
  return /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/i.test(
    String(value || ''),
  )
}

function hasAiC2paEvidence(active, actions) {
  if (isAiSourceType(active?.digital_source_type)) return true
  if (isAiSourceType(active?.digitalSourceType)) return true
  if (actions.some((action) => isAiSourceType(action))) return true
  const assertions = Array.isArray(active?.assertions)
    ? active.assertions
    : active?.assertions && typeof active.assertions === 'object'
      ? Object.values(active.assertions)
      : []
  for (const assertion of assertions) {
    const values = assertion?.data?.actions || assertion?.actions || []
    if (
      (Array.isArray(values) ? values : [values]).some((action) =>
        isAiSourceType(
          action?.digital_source_type || action?.digitalSourceType,
        ),
      )
    ) {
      return true
    }
  }
  return false
}

async function defaultC2paReaderFactory(buffer, options = {}) {
  const module = await import('@contentauth/c2pa-node')
  const Reader = module.Reader || module.default?.Reader
  if (!Reader?.fromAsset) throw new Error('C2PA Reader API unavailable')
  return Reader.fromAsset(
    {
      buffer: asBuffer(buffer),
      mimeType: options.mimeType || 'application/octet-stream',
    },
    options.readerSettings,
  )
}

function isC2paComponentUnavailable(error, message) {
  return (
    error?.code === 'ERR_MODULE_NOT_FOUND' ||
    /C2PA Reader API unavailable|cannot find (?:package|module)|module not found|could not locate (?:the )?bindings?|no native build was found|native bindings? (?:is |are )?(?:missing|unavailable|not found)/i.test(
      message,
    )
  )
}

export async function checkC2pa(buffer, options = {}) {
  if (options.enable === false) {
    return {
      provider: 'c2pa',
      status: 'unavailable',
      evidence: {},
      reason: 'disabled',
    }
  }
  try {
    const readerOptions = {
      ...options,
      readerSettings: {
        ...options.readerSettings,
        verify: {
          ...options.readerSettings?.verify,
          ocsp_fetch: false,
          remote_manifest_fetch: false,
        },
      },
    }
    const reader = await withTimeout(
      (options.readerFactory || defaultC2paReaderFactory)(
        buffer,
        readerOptions,
      ),
      options.timeoutMs,
    )
    const active =
      typeof reader?.getActive === 'function' ? reader.getActive() : null
    if (!active)
      return { provider: 'c2pa', status: 'not_detected', evidence: {} }
    const manifestStore =
      typeof reader?.json === 'function' ? reader.json() || {} : {}
    const validationStatuses = Array.isArray(manifestStore.validation_status)
      ? manifestStore.validation_status
      : []
    const validationState =
      active.validation_state ||
      active.validationState ||
      active.validation?.state ||
      (validationStatuses.length > 0
        ? validationStatuses.map((entry) => entry?.code || entry).join(',')
        : 'trusted')
    const evidence = {
      manifestLabel: active.label || active.label_id || active.manifest_label,
      validationState,
      issuer: active.issuer,
      claimGenerator: active.claim_generator_info?.[0]?.name,
      actions: toActions(active),
      validationStatuses,
    }
    evidence.aiGenerated = hasAiC2paEvidence(active, evidence.actions)
    const trusted = /^(trusted|valid)$/i.test(validationState)
    return {
      provider: 'c2pa',
      status: evidence.aiGenerated && trusted ? 'detected' : 'not_detected',
      evidence,
    }
  } catch (error) {
    const message = safeError(error)
    return {
      provider: 'c2pa',
      status: 'error',
      error: message,
      reason: isC2paComponentUnavailable(error, message)
        ? 'component_unavailable'
        : undefined,
      evidence: {},
    }
  }
}

function makeImageForm(
  buffer,
  fieldName,
  filename = 'image',
  mimeType = 'application/octet-stream',
) {
  const form = new UndiciFormData()
  form.append(
    fieldName,
    new File([asBuffer(buffer)], filename, { type: mimeType }),
  )
  return form
}

function normalizeOpenAiSignals(payload) {
  const entries = Array.isArray(payload?.results) ? payload.results : []
  return entries.map((entry) => ({
    type: entry?.type || 'unknown',
    outcome: entry?.outcome || 'unknown',
    validationState: entry?.validation_state || entry?.validationState,
    issuer: entry?.issuer,
    model: entry?.model,
  }))
}

export async function checkOpenAi(buffer, options = {}) {
  const apiKeys = getApiKeys(options)
  const credentialCount = apiKeys.length
  if (options.enable === false || apiKeys.length === 0) {
    return {
      provider: 'openai',
      status: 'unavailable',
      signals: [],
      reason: 'missing_api_key',
      attempts: 0,
      credentialCount,
    }
  }
  const fetchImpl = options.fetchImpl || undiciFetch
  if (typeof fetchImpl !== 'function') {
    return {
      provider: 'openai',
      status: 'unavailable',
      signals: [],
      reason: 'fetch_unavailable',
      attempts: 0,
      credentialCount,
    }
  }
  let lastError
  let attempts = 0
  for (const apiKey of nextRotation('openai', apiKeys)) {
    attempts += 1
    try {
      const payload = await fetchJson(
        fetchImpl,
        options.endpoint || OPENAI_ENDPOINT,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: makeImageForm(
            buffer,
            'file',
            'image',
            options.mimeType || 'application/octet-stream',
          ),
          proxyOptions: options,
        },
        options.timeoutMs,
      )
      const signals = normalizeOpenAiSignals(payload)
      const status = signals.some((entry) => entry.outcome === 'detected')
        ? 'detected'
        : signals.length > 0 &&
            signals.every((entry) => entry.outcome === 'not_detected')
          ? 'not_detected'
          : 'error'
      return {
        provider: 'openai',
        status,
        signals,
        reason: status === 'error' ? 'invalid_response' : undefined,
        attempts,
        credentialCount,
      }
    } catch (error) {
      lastError = error
      if (![401, 403, 404, 429].includes(error?.status)) break
    }
  }
  const status = [401, 403, 404, 429].includes(lastError?.status)
    ? 'unavailable'
    : 'error'
  const failure = providerErrorDetails(lastError, apiKeys, options)
  return {
    provider: 'openai',
    status,
    error: failure.message,
    errorCodes: failure.codes,
    apiError: failure.apiError,
    httpStatus: lastError?.status,
    signals: [],
    attempts,
    credentialCount,
  }
}

function numberValue(value) {
  if (
    typeof value !== 'number' &&
    !(typeof value === 'string' && value.trim() !== '')
  ) {
    return undefined
  }
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1
    ? number
    : undefined
}

function normalizeHive(payload) {
  const classList = Array.isArray(payload?.output)
    ? payload.output.flatMap((entry) =>
        Array.isArray(entry?.classes) ? entry.classes : [],
      )
    : []
  const valueOf = (className) =>
    numberValue(classList.find((entry) => entry?.class === className)?.value)
  const aiGeneratedProbability =
    valueOf('ai_generated') ??
    (valueOf('not_ai_generated') === undefined
      ? undefined
      : 1 - valueOf('not_ai_generated'))
  const deepfakeProbability = valueOf('deepfake')
  const nonSourceClasses = new Set([
    'ai_generated',
    'not_ai_generated',
    'deepfake',
    'ai_generated_audio',
    'not_ai_generated_audio',
    'none',
    'inconclusive',
    'inconclusive_video',
  ])
  const sourceClass = classList
    .filter(
      (entry) =>
        typeof entry?.class === 'string' &&
        !nonSourceClasses.has(entry.class) &&
        numberValue(entry.value) !== undefined,
    )
    .sort(
      (left, right) => numberValue(right.value) - numberValue(left.value),
    )[0]
  const aiDetected =
    aiGeneratedProbability !== undefined && aiGeneratedProbability >= 0.9
  const deepfakeDetected =
    deepfakeProbability !== undefined && deepfakeProbability >= 0.9
  return {
    aiGeneratedProbability,
    generator: sourceClass?.class,
    generatorProbability: numberValue(sourceClass?.value),
    deepfake: deepfakeProbability === undefined ? undefined : deepfakeDetected,
    deepfakeProbability,
    raw: payload,
    _recognized:
      aiGeneratedProbability !== undefined || deepfakeProbability !== undefined,
    _detected: aiDetected || deepfakeDetected,
  }
}

export async function checkHive(buffer, options = {}) {
  const apiKeys = getApiKeys(options)
  const credentialCount = apiKeys.length
  if (options.enable === false || apiKeys.length === 0) {
    return {
      provider: 'hive',
      status: 'unavailable',
      evidence: {},
      reason: 'missing_api_key',
      attempts: 0,
      credentialCount,
    }
  }
  const fetchImpl = options.fetchImpl || undiciFetch
  if (typeof fetchImpl !== 'function') {
    return {
      provider: 'hive',
      status: 'unavailable',
      evidence: {},
      reason: 'fetch_unavailable',
      attempts: 0,
      credentialCount,
    }
  }
  let lastError
  let attempts = 0
  for (const apiKey of nextRotation('hive', apiKeys)) {
    attempts += 1
    try {
      const form = makeImageForm(
        buffer,
        'media',
        'image',
        options.mimeType || 'application/octet-stream',
      )
      form.append('processing_mode', 'sync_with_fallback')
      const payload = await fetchJson(
        fetchImpl,
        options.endpoint || HIVE_ENDPOINT,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
          proxyOptions: options,
        },
        options.timeoutMs,
      )
      const evidence = normalizeHive(payload)
      const status = !evidence._recognized
        ? 'error'
        : evidence._detected
          ? 'detected'
          : 'not_detected'
      delete evidence._recognized
      delete evidence._detected
      return {
        provider: 'hive',
        status,
        evidence,
        reason: status === 'error' ? 'invalid_response' : undefined,
        attempts,
        credentialCount,
      }
    } catch (error) {
      lastError = error
      if (![401, 403, 429].includes(error?.status)) break
    }
  }
  const status = [401, 403, 404, 429].includes(lastError?.status)
    ? 'unavailable'
    : 'error'
  const failure = providerErrorDetails(lastError, apiKeys, options)
  return {
    provider: 'hive',
    status,
    error: failure.message,
    errorCodes: failure.codes,
    apiError: failure.apiError,
    httpStatus: lastError?.status,
    evidence: {},
    attempts,
    credentialCount,
  }
}

function normalizeSightengine(payload) {
  const value =
    payload?.type?.ai_generated ?? payload?.ai_generated ?? payload?.genai
  const probability = numberValue(
    typeof value === 'object' ? (value.probability ?? value.score) : value,
  )
  return { aiGeneratedProbability: probability, raw: payload }
}

export async function checkSightengine(buffer, options = {}) {
  const credentials = getCredentialPairs(options)
  const credentialCount = credentials.length
  if (options.enable === false || credentials.length === 0) {
    return {
      provider: 'sightengine',
      status: 'unavailable',
      evidence: {},
      reason: 'missing_credentials',
      attempts: 0,
      credentialCount,
    }
  }
  const fetchImpl = options.fetchImpl || undiciFetch
  if (typeof fetchImpl !== 'function') {
    return {
      provider: 'sightengine',
      status: 'unavailable',
      evidence: {},
      reason: 'fetch_unavailable',
      attempts: 0,
      credentialCount,
    }
  }
  let lastError
  let attempts = 0
  for (const credential of nextRotation('sightengine', credentials)) {
    attempts += 1
    try {
      const url = new URL(options.endpoint || SIGHTENGINE_ENDPOINT)
      const form = makeImageForm(
        buffer,
        'media',
        'image',
        options.mimeType || 'application/octet-stream',
      )
      form.append('api_user', credential.apiUser)
      form.append('api_secret', credential.apiSecret)
      form.append('models', 'genai')
      const payload = await fetchJson(
        fetchImpl,
        url,
        { method: 'POST', body: form, proxyOptions: options },
        options.timeoutMs,
      )
      const evidence = normalizeSightengine(payload)
      return {
        provider: 'sightengine',
        status:
          evidence.aiGeneratedProbability === undefined
            ? 'error'
            : evidence.aiGeneratedProbability >= 0.5
              ? 'detected'
              : 'not_detected',
        reason:
          evidence.aiGeneratedProbability === undefined
            ? 'invalid_response'
            : undefined,
        evidence,
        attempts,
        credentialCount,
      }
    } catch (error) {
      lastError = error
      if (![401, 403, 429].includes(error?.status)) break
    }
  }
  const status = [401, 403, 404, 429].includes(lastError?.status)
    ? 'unavailable'
    : 'error'
  const credentialSecrets = credentials.flatMap(({ apiUser, apiSecret }) => [
    apiUser,
    apiSecret,
  ])
  const failure = providerErrorDetails(lastError, credentialSecrets, options)
  return {
    provider: 'sightengine',
    status,
    error: failure.message,
    errorCodes: failure.codes,
    apiError: failure.apiError,
    httpStatus: lastError?.status,
    evidence: {},
    attempts,
    credentialCount,
  }
}

function hasTrustedProvenance(result) {
  if (result.provider === 'c2pa') {
    return (
      /^(trusted|valid)$/i.test(result.evidence?.validationState) &&
      result.evidence?.aiGenerated !== false
    )
  }
  return (
    result.provider === 'openai' &&
    result.signals?.some(
      (signal) =>
        signal.outcome === 'detected' &&
        (signal.type === 'synthid' ||
          (signal.type === 'c2pa' &&
            /^(trusted|valid)$/i.test(signal.validationState))),
    )
  )
}

const PROVIDER_NAMES = {
  c2pa: 'C2PA',
  openai: 'OpenAI',
  hive: 'Hive',
  sightengine: 'Sightengine',
}

const STATUS_NAMES = {
  unavailable: '未配置或不可用',
  error: '检测失败',
}

const REASON_NAMES = {
  disabled: '已禁用',
  missing_api_key: '未配置 API Key',
  missing_credentials: '未配置 API 凭据',
  fetch_unavailable: '当前 Node 环境不支持网络请求',
  component_unavailable: '本地检测组件不可用',
  invalid_response: '响应格式无法识别',
}

function displayValue(value, maxLength = 80) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function formatProbability(value) {
  const probability = numberValue(value)
  return probability === undefined
    ? undefined
    : `${(probability * 100).toFixed(1)}%`
}

function formatNonZeroProbability(value) {
  const probability = formatProbability(value)
  return probability === '0.0%' ? undefined : probability
}

function describeC2paEvidence(result) {
  const evidence = result.evidence || {}
  if (result.status !== 'detected') return '未检测到'

  const details = []
  if (evidence.issuer) details.push(`签发者：${displayValue(evidence.issuer)}`)
  if (evidence.claimGenerator)
    details.push(`生成工具：${displayValue(evidence.claimGenerator)}`)
  if (evidence.validationState)
    details.push(`校验：${displayValue(evidence.validationState)}`)
  return details.length > 0 ? details.join('，') : '已检测到'
}

function signalName(type) {
  const normalized = displayValue(type || '未知信号')
  return (
    { synthid: 'SynthID', c2pa: 'C2PA' }[normalized.toLowerCase()] || normalized
  )
}

function describeOpenAiEvidence(result) {
  if (result.status !== 'detected') return '未检测到'
  const signals = Array.isArray(result.signals)
    ? result.signals
        .filter((signal) => signal.outcome === 'detected')
        .map((signal) => signalName(signal.type))
    : []
  return signals.length > 0 ? [...new Set(signals)].join('、') : '已检测到'
}

function describeHiveEvidence(result) {
  const evidence = result.evidence || {}
  const aiProbability = formatProbability(evidence.aiGeneratedProbability)
  const generatorProbability = formatNonZeroProbability(
    evidence.generatorProbability,
  )
  const deepfakeProbability = formatNonZeroProbability(
    evidence.deepfakeProbability,
  )
  const details = []
  if (
    evidence.aiGeneratedProbability >= 0.9 &&
    evidence.generator &&
    generatorProbability
  ) {
    details.push(`${displayValue(evidence.generator)} ${generatorProbability}`)
  }
  if (deepfakeProbability) {
    details.push(`Deepfake ${deepfakeProbability}`)
  }
  if (aiProbability) {
    const suffix = details.length > 0 ? `（${details.join('，')}）` : ''
    return `AI 生成概率 ${aiProbability}${suffix}`
  }
  if (details.length > 0) return details.join('，')
  return result.status === 'detected' ? '已检测到' : '未检测到'
}

function describeSightengineEvidence(result) {
  const probability = formatProbability(result.evidence?.aiGeneratedProbability)
  if (probability) return `AI 生成概率 ${probability}`
  return result.status === 'detected' ? '已检测到' : '未检测到'
}

function describeProviderEvidence(result) {
  return {
    c2pa: describeC2paEvidence,
    openai: describeOpenAiEvidence,
    hive: describeHiveEvidence,
    sightengine: describeSightengineEvidence,
  }[result.provider]?.(result)
}

function describeProviderStatus(result) {
  if (result.status === 'detected' || result.status === 'not_detected') {
    return (
      describeProviderEvidence(result) ||
      (result.status === 'detected' ? '已检测到相关信号' : '未检测到相关信号')
    )
  }
  if (REASON_NAMES[result.reason]) return REASON_NAMES[result.reason]

  const httpStatus = Number(result.httpStatus)
  if (Number.isInteger(httpStatus)) {
    return `API HTTP ${httpStatus}`
  }

  const error = safeError(result.error).trim()
  if (/超时|timeout|aborted?/i.test(error)) return '请求超时'
  if (/fetch failed|network|socket|connect|dns/i.test(error))
    return '网络请求失败'
  if (error) return `检测失败（${error.replace(/\s+/g, ' ').slice(0, 120)}）`
  return STATUS_NAMES[result.status] || result.status
}

function providerStatusIcon(result) {
  return {
    detected: '✅',
    not_detected: 'ℹ️',
    unavailable: '⏸️',
    error: '❌',
  }[result.status]
}

function summarizeProviderStatuses(results) {
  if (results.length === 0) return ''
  return results
    .map(
      (result) =>
        `${providerStatusIcon(result) || '•'} ${PROVIDER_NAMES[result.provider] || result.provider}：${
          result.provider === 'hive' && result.reason === 'missing_api_key'
            ? '未配置 V3 Secret Key'
            : describeProviderStatus(result)
        }`,
    )
    .join('\n')
}

export function summarizeAiImageResults(results = [], options = {}) {
  const normalized = Array.isArray(results) ? results.filter(Boolean) : []
  const trusted = normalized.find(
    (result) => result.status === 'detected' && hasTrustedProvenance(result),
  )
  const detected = normalized.filter((result) => result.status === 'detected')
  const unavailable = normalized.filter(
    (result) => result.status === 'unavailable',
  )
  const errors = normalized.filter((result) => result.status === 'error')
  let verdict = 'unknown'
  let confidence = 'low'
  let verdictIcon = '❔'
  let conclusion = '暂未发现明确的 AI 来源信号，证据不足'

  if (options.noProvidersEnabled === true) {
    conclusion = '未启用任何检测渠道，请先在配置中启用至少一个渠道'
  } else if (trusted) {
    verdict = 'detected'
    confidence = 'high'
    verdictIcon = '✅'
    const synthid = trusted.signals?.some(
      (signal) => signal.type === 'synthid' && signal.outcome === 'detected',
    )
    if (synthid) {
      conclusion = '检测到 OpenAI SynthID 信号'
    } else {
      const issuer = trusted.evidence?.issuer
        ? `（签发者：${displayValue(trusted.evidence.issuer)}）`
        : ''
      conclusion = `检测到可信 C2PA 来源凭证${issuer}`
    }
  } else if (detected.length > 0) {
    verdict = 'detected'
    confidence = 'medium'
    verdictIcon = '⚠️'
    const hasProbabilisticDetection = detected.some((result) =>
      ['hive', 'sightengine'].includes(result.provider),
    )
    conclusion = hasProbabilisticDetection
      ? '检测到 AI 生成或篡改信号（概率模型），请结合来源凭证复核'
      : '检测到来源信号，请结合其他渠道复核'
  } else if (unavailable.length > 0 || errors.length > 0) {
    verdictIcon = '⚠️'
    conclusion = '检测渠道不可用或失败，无法形成可靠结论'
  }

  const providerStatuses = summarizeProviderStatuses(normalized)
  const confidenceName = { high: '高', medium: '中', low: '低' }[confidence]
  let message = [
    '🔎 AI 图片识别结果',
    '',
    `${verdictIcon} 结论：${conclusion}`,
    `📊 可信度：${confidenceName}`,
  ].join('\n')
  if (providerStatuses) {
    message += `\n\n检测渠道：\n${providerStatuses}`
  }
  message += '\n\nℹ️ 未检出不代表图片一定不是 AI 生成。'

  return { verdict, confidence, message, results: normalized }
}

export {
  OPENAI_ENDPOINT,
  HIVE_ENDPOINT,
  SIGHTENGINE_ENDPOINT,
  normalizeOpenAiSignals,
  normalizeHive,
  normalizeSightengine,
}
