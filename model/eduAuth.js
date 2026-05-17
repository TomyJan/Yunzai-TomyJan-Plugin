import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { dataPath } from '../data/system/pluginConstants.js'

function sleepAsync(sleepms) {
  return new Promise((resolve) => {
    setTimeout(resolve, sleepms)
  })
}

/**
 * 将 API 返回的 UTC 时间字符串解析为 Date 对象
 * 上游 API 返回的时间为 UTC，若字符串无时区标识则自动按 UTC 解析
 * @param {string} dateStr - UTC 时间字符串
 * @returns {Date}
 */
function parseUTCDate(dateStr) {
  if (!dateStr) return new Date(NaN)
  if (/Z|[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr)
  }
  return new Date(dateStr + 'Z')
}

/**
 * 将 Date 对象格式化为 UTC+8 时间字符串
 * @param {Date} date - Date 对象
 * @param {boolean} includeTime - 是否包含时分
 * @returns {string}
 */
export function formatDateUTC8(date, includeTime = true) {
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const y = utc8.getUTCFullYear()
  const m = String(utc8.getUTCMonth() + 1).padStart(2, '0')
  const d = String(utc8.getUTCDate()).padStart(2, '0')
  if (!includeTime) return `${y}.${m}.${d}`
  const h = String(utc8.getUTCHours()).padStart(2, '0')
  const min = String(utc8.getUTCMinutes()).padStart(2, '0')
  return `${y}.${m}.${d} ${h}:${min}`
}

// 用户缓存文件路径
const USER_CACHE_FILE = path.join(dataPath, 'system/eduUserCache.json')
const TASK_CODE_CONTRACT_REFRESH_INTERVAL = 24 * 60 * 60 * 1000

const TASK_CODE_CONTRACT_SNAPSHOT = {
  codes: {
    SUCCESS: 0,
    QUEUE_WAITING: 100,
    QUEUE_RUNNING: 101,
    CLIENT_IP_INVALID: 200,
    CLIENT_SEGMENT_UNSUPPORTED: 201,
    AUTH_ENDPOINT_UNAVAILABLE: 300,
    AUTH_MAX_ATTEMPTS_REACHED: 301,
    AUTH_PARAM_MISMATCH: 302,
    AUTH_TASK_TIMEOUT: 303,
    AUTH_LOCKED_SUCCESS: 304,
    AUTH_LOCKED_FAIL: 305,
    AUTH_WORKER_STARTING: 400,
    AUTH_WORKER_RECOVERING: 401,
    AUTH_WORKER_FATAL: 402,
    AUTH_WORKER_UNAVAILABLE: 403,
    SYSTEM_ERROR: 900,
  },
  metadata: [
    {
      key: 'SUCCESS',
      code: 0,
      category: 'success',
      defaultMessage: '认证成功',
      severity: 'success',
      terminal: true,
      processing: false,
    },
    {
      key: 'QUEUE_WAITING',
      code: 100,
      category: 'queue',
      defaultMessage: '任务等待中',
      severity: 'info',
      terminal: false,
      processing: true,
    },
    {
      key: 'QUEUE_RUNNING',
      code: 101,
      category: 'queue',
      defaultMessage: '认证初始化中 / 认证中',
      severity: 'info',
      terminal: false,
      processing: true,
    },
    {
      key: 'CLIENT_IP_INVALID',
      code: 200,
      category: 'client',
      defaultMessage: 'IP 格式错误',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'CLIENT_SEGMENT_UNSUPPORTED',
      code: 201,
      category: 'client',
      defaultMessage: 'IP 段不支持',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_ENDPOINT_UNAVAILABLE',
      code: 300,
      category: 'auth',
      defaultMessage: '认证失败：暂无可用端点',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_MAX_ATTEMPTS_REACHED',
      code: 301,
      category: 'auth',
      defaultMessage: '认证失败：已达尝试上限',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_PARAM_MISMATCH',
      code: 302,
      category: 'auth',
      defaultMessage: '认证失败：认证参数不匹配',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_TASK_TIMEOUT',
      code: 303,
      category: 'auth',
      defaultMessage: '认证失败：任务超时',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_LOCKED_SUCCESS',
      code: 304,
      category: 'auth',
      defaultMessage: '此 IP 近期已认证成功',
      severity: 'success',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_LOCKED_FAIL',
      code: 305,
      category: 'auth',
      defaultMessage: '此 IP 近期认证失败次数过多',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_WORKER_STARTING',
      code: 400,
      category: 'auth-worker',
      defaultMessage: '认证服务启动中',
      severity: 'warning',
      terminal: false,
      processing: true,
    },
    {
      key: 'AUTH_WORKER_RECOVERING',
      code: 401,
      category: 'auth-worker',
      defaultMessage: '认证服务恢复中',
      severity: 'warning',
      terminal: false,
      processing: true,
    },
    {
      key: 'AUTH_WORKER_FATAL',
      code: 402,
      category: 'auth-worker',
      defaultMessage: '认证服务不可用',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'AUTH_WORKER_UNAVAILABLE',
      code: 403,
      category: 'auth-worker',
      defaultMessage: '认证服务暂不可用',
      severity: 'error',
      terminal: true,
      processing: false,
    },
    {
      key: 'SYSTEM_ERROR',
      code: 900,
      category: 'system',
      defaultMessage: '系统错误',
      severity: 'error',
      terminal: true,
      processing: false,
    },
  ],
}

const LEGACY_TASK_CODE_MESSAGES = {
  1: '排队中',
  2: '认证中',
  10: '提交失败：IP 格式错误',
  11: '提交失败：校区暂不支持',
  20: '认证失败: 暂无可用端点',
  21: '认证失败: 已达尝试上限',
  22: '认证失败：电信系统返回未知错误',
  23: '认证失败: 任务超时',
  24: '系统错误',
  25: '此 IP 近期已认证成功，请检查',
  26: '此 IP 近期认证失败过多，请检查',
}

// 第三方 API 固定 Key ID
const MOE_KEY_ID = 'moe_thirdParty'

let taskCodeContractCache = null
let taskCodeContractUpdateTime = 0
let taskCodeMetadataByCode = new Map()

// 上次使用的时间戳，用于防重放
let lastTimestamp = 0

/**
 * 获取唯一的毫秒级时间戳（避免重复）
 * @returns {string} - 毫秒级时间戳
 */
function getUniqueTimestamp() {
  let timestamp = Date.now()
  do {
    timestamp = Date.now()
  } while (timestamp <= lastTimestamp)
  lastTimestamp = timestamp
  return timestamp.toString()
}

/**
 * 计算 MD5 签名
 * @param {string} keyId - Key ID
 * @param {string} keySecret - API Key (密钥)
 * @param {string} timestamp - 毫秒级时间戳
 * @param {string} method - HTTP 方法 (大写)
 * @param {string} urlPath - 请求路径
 * @param {string} body - 请求体 (压缩 JSON)
 * @returns {string} - MD5 签名
 */
function generateSign(keyId, keySecret, timestamp, method, urlPath, body) {
  const raw = `${keyId}${keySecret}${timestamp}${method.toUpperCase()}${urlPath}${body}`
  return crypto.createHash('md5').update(raw).digest('hex')
}

/**
 * 获取配置
 * @returns {object} - eduAuth 配置
 */
function getEduConfig() {
  const config_ = config.getConfig()
  if (!config_) {
    throw new Error('CONFIG 未初始化')
  }
  const eduAuthConfig = config_.eduAuth
  if (!eduAuthConfig) {
    throw new Error('EDU 配置未找到')
  }
  return eduAuthConfig
}

/**
 * 发起 API 请求
 * @param {string} endpoint - API 端点路径
 * @param {object} data - 请求数据
 * @param {object} options - 请求选项
 * @returns {Promise<object>} - { success: boolean, data?: any, message?: string, code?: number }
 */
async function apiRequest(endpoint, data = {}, options = {}) {
  const cfg = getEduConfig()
  const apiBaseUrl = cfg.apiBaseUrl
  const apiKey = cfg.apiKey

  if (!apiBaseUrl || !apiKey) {
    return { success: false, message: 'API 配置不完整' }
  }

  // 构建完整 URL 和路径
  const baseUrl = apiBaseUrl.endsWith('/')
    ? apiBaseUrl.slice(0, -1)
    : apiBaseUrl
  const url = `${baseUrl}/${endpoint}`

  // 解析 URL 获取路径部分
  const urlObj = new URL(url)
  const urlPath = urlObj.pathname

  // 准备请求体（压缩 JSON，无空白字符）
  const method = (options.method || 'POST').toUpperCase()
  const body = method === 'GET' ? '' : JSON.stringify(data)

  // 获取唯一时间戳并生成签名
  const timestamp = getUniqueTimestamp()
  const sign = generateSign(
    MOE_KEY_ID,
    apiKey,
    timestamp,
    method,
    urlPath,
    body,
  )

  const headers = {
    'Content-Type': 'application/json',
    'X-Moe-Key-Id': MOE_KEY_ID,
    'X-Moe-Time': timestamp,
    'X-Moe-Sign': sign,
  }

  tjLogger.debug(`[EDU] API 请求: ${url}`)
  tjLogger.debug(`[EDU] 请求方法: ${method}`)
  if (body) {
    tjLogger.debug(`[EDU] 请求数据: ${body}`)
  }

  try {
    const fetchOptions = {
      method,
      headers,
    }
    if (method !== 'GET') {
      fetchOptions.body = body
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      const errMsg = `HTTP ${response.status} ${response.statusText}`
      tjLogger.error(`[EDU] API 请求失败: ${errMsg}`)
      return { success: false, message: errMsg }
    }

    const jsonData = await response.json()
    tjLogger.debug(`[EDU] API 响应: ${JSON.stringify(jsonData)}`)

    if (!jsonData || jsonData.code !== 0) {
      return {
        success: false,
        message: jsonData?.message || '请求失败',
        code: jsonData?.code,
      }
    }

    // 返回数据可能为 null，需要处理
    return {
      success: true,
      data: jsonData.data || {},
    }
  } catch (error) {
    tjLogger.error(`[EDU] API 请求错误: ${error.message}`)
    return { success: false, message: error.message }
  }
}

// ==================== 任务码契约管理 ====================

function normalizeTaskCodeContract(contract) {
  if (!contract || typeof contract !== 'object') return null
  if (!contract.codes || typeof contract.codes !== 'object') return null
  if (!Array.isArray(contract.metadata)) return null

  const metadata = contract.metadata
    .map((item) => {
      const code = Number(item?.code)
      if (!Number.isFinite(code)) return null
      return {
        ...item,
        code,
      }
    })
    .filter(Boolean)

  return {
    codes: contract.codes,
    metadata,
  }
}

function setTaskCodeContractCache(contract, updateTime = Date.now()) {
  const normalized = normalizeTaskCodeContract(contract)
  if (!normalized) return false

  taskCodeContractCache = normalized
  taskCodeContractUpdateTime = updateTime
  taskCodeMetadataByCode = new Map(
    normalized.metadata.map((item) => [item.code, item]),
  )
  return true
}

function getFallbackTaskCodeContract() {
  if (taskCodeContractCache) {
    return {
      contract: taskCodeContractCache,
      updateTime: taskCodeContractUpdateTime,
    }
  }

  setTaskCodeContractCache(TASK_CODE_CONTRACT_SNAPSHOT, 0)
  return {
    contract: taskCodeContractCache,
    updateTime: taskCodeContractUpdateTime,
  }
}

export async function refreshTaskCodeContract(force = false) {
  const now = Date.now()
  if (
    !force &&
    taskCodeContractCache &&
    now - taskCodeContractUpdateTime < TASK_CODE_CONTRACT_REFRESH_INTERVAL
  ) {
    return { success: true, data: taskCodeContractCache, fromCache: true }
  }

  const result = await apiRequest('system/task-codes', {}, { method: 'GET' })
  if (result.success) {
    const normalized = normalizeTaskCodeContract(result.data)
    if (normalized && setTaskCodeContractCache(normalized, now)) {
      return { success: true, data: normalized, fromCache: false }
    }
    tjLogger.warn('[EDU] 任务码契约格式异常，使用本地兜底契约')
  } else {
    tjLogger.warn(`[EDU] 刷新任务码契约失败: ${result.message}`)
  }

  const fallback = getFallbackTaskCodeContract()
  return {
    success: true,
    data: fallback.contract,
    fromCache: true,
    message: result.message,
  }
}

export async function ensureTaskCodeContract() {
  const now = Date.now()
  if (
    taskCodeContractCache &&
    now - taskCodeContractUpdateTime < TASK_CODE_CONTRACT_REFRESH_INTERVAL
  ) {
    return { success: true, data: taskCodeContractCache, fromCache: true }
  }
  return await refreshTaskCodeContract(false)
}

export function getTaskCodeMetadata(taskCode) {
  const code = Number(taskCode)
  if (!Number.isFinite(code)) return null
  if (taskCodeMetadataByCode.size === 0) {
    getFallbackTaskCodeContract()
  }
  return taskCodeMetadataByCode.get(code) || null
}

// ==================== 用户缓存管理 ====================

/**
 * 读取用户缓存
 * @returns {object} - { items: { [qq]: userInfo }, updateTime: number }
 */
export function readUserCache() {
  try {
    if (fs.existsSync(USER_CACHE_FILE)) {
      const data = fs.readFileSync(USER_CACHE_FILE, 'utf8')
      return JSON.parse(data)
    }
  } catch (error) {
    tjLogger.error(`[EDU] 读取用户缓存失败: ${error.message}`)
  }
  return { items: {}, updateTime: 0 }
}

/**
 * 保存用户缓存
 * @param {object} cache - 缓存数据
 */
export function saveUserCache(cache) {
  try {
    const dir = path.dirname(USER_CACHE_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(USER_CACHE_FILE, JSON.stringify(cache, null, 2))
    tjLogger.debug('[EDU] 用户缓存已保存')
  } catch (error) {
    tjLogger.error(`[EDU] 保存用户缓存失败: ${error.message}`)
  }
}

/**
 * 从缓存获取用户信息
 * @param {string} qq - QQ 号
 * @returns {object|null} - 用户信息或 null
 */
export function getUserFromCache(qq) {
  const cache = readUserCache()
  return cache.items[qq] || null
}

/**
 * 获取用户的详细状态
 * @param {object|null} userInfo - 用户信息
 * @returns {string} - 用户状态: 'active', 'grace_period', 'expired', 'pending', 'banned', 'unknown'
 */
export function getUserStatus(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return 'unknown'

  // 待审核
  if (userInfo.status === 'pending') return 'pending'
  // 已封禁
  if (userInfo.status === 'banned') return 'banned'
  // 已停用 (区别于封禁，可由管理员恢复)
  if (userInfo.status === 'disabled') return 'disabled'
  // 异常状态
  if (userInfo.status !== 'active') return 'unknown'

  // 检查过期情况
  const expireAtStr = userInfo.expireAt
  if (!expireAtStr) {
    // null 表示永久有效
    return 'active'
  }

  const expireTime = parseUTCDate(expireAtStr).getTime()
  if (isNaN(expireTime)) {
    // 日期格式错误
    return 'unknown'
  }

  const now = Date.now()
  if (expireTime >= now) {
    // 未过期
    return 'active'
  }

  // 已过期，检查宽限期
  const role = userInfo.role
  const graceDays = (role && role.graceDays) || 0
  const graceAuthCount = (role && role.graceAuthCount) || 0
  const graceUsed = userInfo.graceUsed || 0

  if (graceAuthCount > 0 && graceUsed < graceAuthCount && expireTime + graceDays * 24 * 60 * 60 * 1000 > now) {
    // 还在宽限期内
    return 'grace_period'
  } else {
    // 已过期
    return 'expired'
  }
}

/**
 * 获取用户的宽限期信息
 * @param {object} userInfo - 用户信息
 * @returns {object} - { isInGracePeriod: boolean, daysRemaining?: number, usesRemaining?: number, expiredDaysAgo?: number }
 */
export function getGracePeriodInfo(userInfo) {
  if (!userInfo) {
    return { isInGracePeriod: false }
  }

  // expireAt 可能为 null（表示永久有效）或 undefined
  const expireAtStr = userInfo.expireAt
  if (!expireAtStr) {
    // 永久有效
    return { isInGracePeriod: false, daysRemaining: Infinity }
  }

  const expireTime = parseUTCDate(expireAtStr).getTime()
  const now = Date.now()
  const msPerDay = 24 * 60 * 60 * 1000

  if (expireTime >= now) {
    // 未过期
    const daysRemaining = Math.ceil((expireTime - now) / msPerDay)
    return {
      isInGracePeriod: false,
      daysRemaining,
    }
  }

  // 已过期
  const role = userInfo.role
  const graceAuthCount = (role && role.graceAuthCount) || 0
  const graceDays = (role && role.graceDays) || 0
  const graceUsed = userInfo.graceUsed || 0
  const usesRemaining = Math.max(0, graceAuthCount - graceUsed)
  const expiredDaysAgo = Math.floor((now - expireTime) / msPerDay)
  const graceDaysRemaining = Math.max(0, graceDays - expiredDaysAgo)

  return {
    isInGracePeriod: usesRemaining > 0 && graceDaysRemaining > 0,
    usesRemaining,
    expiredDaysAgo,
    graceAuthCount,
    graceDays,
    graceDaysRemaining,
    graceUsed,
  }
}

/**
 * 判断用户是否有效（可认证）
 * @param {object} userInfo - 用户信息
 * @returns {boolean}
 */
export function isUserValid(userInfo) {
  const status = getUserStatus(userInfo)
  return status === 'active' || status === 'grace_period'
}

/**
 * 获取用户无效原因
 * @param {object|null} userInfo - 用户信息
 * @returns {string} - 无效原因描述
 */
export function getInvalidReason(userInfo) {
  const status = getUserStatus(userInfo)

  switch (status) {
    case 'unknown':
      return userInfo ? '未知状态' : '未注册或未绑定QQ'
    case 'pending':
      return '待审核'
    case 'banned':
      return '已封禁'
    case 'disabled':
      return '已停用'
    case 'expired': {
      const graceInfo = getGracePeriodInfo(userInfo)
      return `已过期 (${graceInfo.expiredDaysAgo}天前)`
    }
    case 'grace_period':
      return '宽限期内'
    case 'active':
    default:
      return '正常'
  }
}

// ==================== API 封装 ====================

/**
 * 按 QQ 号查询用户信息
 * @param {string[]} qqList - QQ 号列表，为空则查询所有
 * @returns {Promise<object>} - { success, data?: { items, unkQQUser }, message? }
 */
export async function getUsersByQQ(qqList = []) {
  return await apiRequest('user/listByQQ', { qqList })
}

/**
 * 刷新用户缓存（从 API 获取所有用户并缓存）
 * @returns {Promise<object>} - { success, count?, message? }
 */
export async function refreshUserCache() {
  tjLogger.info('[EDU] 开始刷新用户缓存...')
  const result = await getUsersByQQ([])

  if (!result.success) {
    return { success: false, message: result.message }
  }

  // 安全处理 API 返回的数据
  const apiData = result.data || {}
  const itemsData = apiData.items || {}

  if (typeof itemsData !== 'object' || Array.isArray(itemsData)) {
    tjLogger.error('[EDU] API 返回的 items 格式异常')
    return { success: false, message: 'API 返回数据格式错误' }
  }

  const cache = {
    items: itemsData,
    unkQQUser: apiData.unkQQUser || 0,
    updateTime: Date.now(),
  }

  saveUserCache(cache)
  const count = Object.keys(cache.items).length
  tjLogger.info(
    `[EDU] 用户缓存刷新完成，共 ${count} 个用户，${cache.unkQQUser} 个未绑定QQ`,
  )

  return { success: true, count, unkQQUser: cache.unkQQUser }
}

/**
 * 查询单个用户（先查缓存，无则从 API 获取并更新缓存）
 * @param {string} qq - QQ 号
 * @param {boolean} forceRefresh - 是否强制从 API 刷新
 * @returns {Promise<object>} - { success, data?: userInfo, message? }
 */
export async function getUser(qq, forceRefresh = false) {
  qq = String(qq)

  // 先查缓存
  if (!forceRefresh) {
    const cached = getUserFromCache(qq)
    if (cached) {
      tjLogger.debug(`[EDU] 从缓存获取用户 ${qq}`)
      return { success: true, data: cached, fromCache: true }
    }
  }

  // 缓存没有，从 API 获取
  tjLogger.debug(`[EDU] 从 API 获取用户 ${qq}`)
  const result = await getUsersByQQ([qq])

  if (!result.success) {
    return { success: false, message: result.message }
  }

  const userInfo = result.data.items?.[qq]
  if (!userInfo) {
    return { success: false, message: '用户未注册或未绑定QQ' }
  }

  // 更新缓存
  const cache = readUserCache()
  cache.items[qq] = userInfo
  cache.updateTime = Date.now()
  saveUserCache(cache)

  return { success: true, data: userInfo, fromCache: false }
}

/**
 * 上报 QQ 群成员列表
 * @param {string[]} qqList - 群成员 QQ 号列表
 * @returns {Promise<object>} - { success, data?: { accepted, memberCount }, message? }
 */
export async function reportGroupMembers(qqList) {
  tjLogger.info(`[EDU] 上报群成员，共 ${qqList.length} 人`)
  return await apiRequest('user/reportQQGroupMember', { qqList })
}

/**
 * 提交认证任务
 * @param {string} userId - 用户 UUID
 * @param {string} authIp - 待认证 IP
 * @returns {Promise<object>} - { success, data?: taskInfo, message? }
 */
export async function submitAuth(userId, authIp) {
  tjLogger.info(`[EDU] 提交认证: userId=${userId}, ip=${authIp}`)
  await ensureTaskCodeContract()
  return await apiRequest('wifi/submitAsUser', { userId, authIp })
}

/**
 * 查询认证任务状态
 * @param {string} taskId - 任务 UUID
 * @returns {Promise<object>} - { success, data?: taskInfo, message? }
 */
export async function checkTask(taskId) {
  return await apiRequest('wifi/check', { taskId })
}

/**
 * 获取任务状态码对应的消息
 * @param {number} taskCode - 任务状态码
 * @returns {string} - 状态描述
 */
export function getTaskCodeMessage(taskCode) {
  const metadata = getTaskCodeMetadata(taskCode)
  return (
    metadata?.defaultMessage ||
    LEGACY_TASK_CODE_MESSAGES[taskCode] ||
    `未知状态(${taskCode})`
  )
}

/**
 * 解析认证任务结果
 * @param {object} taskInfo - 任务信息
 * @returns {object} - { done, success, processing, message, metadata }
 */
export function resolveTaskResult(taskInfo = {}) {
  const metadata = getTaskCodeMetadata(taskInfo.taskCode)
  const message =
    taskInfo.message ||
    metadata?.defaultMessage ||
    (taskInfo.taskCode !== undefined
      ? getTaskCodeMessage(taskInfo.taskCode)
      : null)

  if (metadata?.processing === true) {
    return {
      done: false,
      success: false,
      processing: true,
      message: message || '任务处理中',
      metadata,
    }
  }

  if (metadata?.terminal === true) {
    const success = metadata.severity === 'success'
    return {
      done: true,
      success,
      processing: false,
      message: message || (success ? '认证成功！' : '认证失败'),
      metadata,
    }
  }

  if (taskInfo.status === 'success') {
    return {
      done: true,
      success: true,
      processing: false,
      message: taskInfo.message || '认证成功！',
      metadata,
    }
  }

  if (taskInfo.status === 'failed') {
    return {
      done: true,
      success: false,
      processing: false,
      message: message || '认证失败',
      metadata,
    }
  }

  return {
    done: false,
    success: false,
    processing: true,
    message: message || '任务处理中',
    metadata,
  }
}

/**
 * 等待认证任务完成
 * @param {string} taskId - 任务 UUID
 * @param {function} onProgress - 进度回调 (taskInfo) => void
 * @returns {Promise<object>} - { success, message, data?: taskInfo }
 */
export async function waitForAuthResult(taskId, onProgress = null) {
  const maxPolls = 60
  const pollInterval = 2000
  let lastStatus = ''

  await ensureTaskCodeContract()

  for (let i = 0; i < maxPolls; i++) {
    const result = await checkTask(taskId)

    if (!result.success) {
      tjLogger.warn(`[EDU] 第 ${i + 1} 次查询失败: ${result.message}`)
      await sleepAsync(pollInterval)
      continue
    }

    const taskInfo = result.data
    const progressKey = `${taskInfo.status || ''}:${taskInfo.taskCode ?? ''}`

    // 状态变化时回调
    if (onProgress && progressKey !== lastStatus) {
      onProgress(taskInfo)
      lastStatus = progressKey
    }

    const resolved = resolveTaskResult(taskInfo)
    if (resolved.done) {
      return {
        success: resolved.success,
        message: resolved.message,
        data: taskInfo,
      }
    }

    // queued、running 或 processing 状态，继续轮询
    await sleepAsync(pollInterval)
  }

  return { success: false, message: '认证超时，请稍后重试' }
}

// ==================== 群管理功能 ====================

/**
 * 分析用户状态（用于主人检查）
 * @param {object[]} groupMembers - 群成员列表 [{ user_id, ... }]
 * @returns {Promise<object>} - 各类用户分类结果
 */
export async function analyzeUserStatus(groupMembers) {
  // 先刷新缓存获取最新数据
  const refreshResult = await refreshUserCache()
  if (!refreshResult.success) {
    return { success: false, message: refreshResult.message }
  }

  const cache = readUserCache()
  const allUsers = cache.items

  // 群成员 QQ 集合
  const groupMemberSet = new Set(groupMembers.map((m) => String(m.user_id)))

  const result = {
    normalUsers: [], // 正常用户（在群内且有效）
    gracePeriodUsers: [], // 宽限期内的用户（在群内）
    expiredUsers: [], // 已过期的用户（在群内）
    pendingUsers: [], // 待审核用户（在群内）
    bannedUsers: [], // 已封禁用户（在群内）
    disabledUsers: [], // 已停用用户（在群内）
    invalidInGroup: [], // 其他无效用户（在群内）
    validNotInGroup: [], // 有效但未加群的用户
    unregisteredInGroup: [], // 群内未注册用户
    unkQQUser: refreshResult.unkQQUser || 0, // 未绑定 QQ 的用户数
  }

  // 遍历所有已绑定 QQ 的用户
  try {
    for (const [qq, userInfo] of Object.entries(allUsers)) {
      // 确保 userInfo 是对象
      if (!userInfo || typeof userInfo !== 'object') {
        tjLogger.warn(`[EDU] 跳过异常用户数据: ${qq}`)
        continue
      }

      const isInGroup = groupMemberSet.has(qq)
      const status = getUserStatus(userInfo)

      if (isInGroup) {
        // 在群内，按细致的状态分类
        switch (status) {
          case 'active':
            result.normalUsers.push({ qq, ...userInfo })
            break
          case 'grace_period': {
            const graceInfo = getGracePeriodInfo(userInfo)
            result.gracePeriodUsers.push({
              qq,
              ...userInfo,
              graceInfo,
            })
            break
          }
          case 'expired': {
            const graceInfo = getGracePeriodInfo(userInfo)
            result.expiredUsers.push({
              qq,
              ...userInfo,
              graceInfo,
            })
            break
          }
          case 'pending':
            result.pendingUsers.push({ qq, ...userInfo })
            break
          case 'banned':
            result.bannedUsers.push({ qq, ...userInfo })
            break
          case 'disabled':
            result.disabledUsers.push({ qq, ...userInfo })
            break
          default:
            result.invalidInGroup.push({
              qq,
              ...userInfo,
              reason: getInvalidReason(userInfo),
            })
        }
      } else {
        // 不在群内，检查是否有效
        if (status === 'active' || status === 'grace_period') {
          result.validNotInGroup.push({ qq, ...userInfo, status })
        }
      }
    }

    // 检查群内未注册用户
    if (Array.isArray(groupMembers)) {
      for (const member of groupMembers) {
        const qq = String(member.user_id)
        if (!allUsers[qq]) {
          result.unregisteredInGroup.push({
            qq,
            nickname: member.nickname || member.card || qq,
          })
        }
      }
    }
  } catch (error) {
    tjLogger.error(`[EDU] 分析用户状态时出错: ${error.message}`)
    return {
      success: false,
      message: `分析用户状态失败: ${error.message}`,
    }
  }

  return { success: true, data: result }
}

/**
 * 格式化用户状态报告（用于显示）
 * @param {object} analysisResult - analyzeUserStatus 返回的结果对象
 * @returns {string} - 格式化的报告文本
 */
export function formatUserStatusReport(analysisResult) {
  if (!analysisResult || !analysisResult.success || !analysisResult.data) {
    return '获取用户状态失败'
  }

  const data = analysisResult.data
  if (typeof data !== 'object') {
    return '用户状态数据格式错误'
  }

  const lines = []

  // 统计各类用户数量（安全访问 .length）
  const totalNormal =
    (data.normalUsers &&
      Array.isArray(data.normalUsers) &&
      data.normalUsers.length) ||
    0
  const totalGrace =
    (data.gracePeriodUsers &&
      Array.isArray(data.gracePeriodUsers) &&
      data.gracePeriodUsers.length) ||
    0
  const totalExpired =
    (data.expiredUsers &&
      Array.isArray(data.expiredUsers) &&
      data.expiredUsers.length) ||
    0
  const totalPending =
    (data.pendingUsers &&
      Array.isArray(data.pendingUsers) &&
      data.pendingUsers.length) ||
    0
  const totalBanned =
    (data.bannedUsers &&
      Array.isArray(data.bannedUsers) &&
      data.bannedUsers.length) ||
    0
  const totalInvalidOther =
    (data.invalidInGroup &&
      Array.isArray(data.invalidInGroup) &&
      data.invalidInGroup.length) ||
    0
  const totalValidNotInGroup =
    (data.validNotInGroup &&
      Array.isArray(data.validNotInGroup) &&
      data.validNotInGroup.length) ||
    0
  const totalUnregistered =
    (data.unregisteredInGroup &&
      Array.isArray(data.unregisteredInGroup) &&
      data.unregisteredInGroup.length) ||
    0
  const totalUnkQQ = data.unkQQUser || 0

  // 标题和概览（始终显示所有类别）
  lines.push('📊 用户状态概览\n')
  if (totalNormal > 0 ) lines.push(`✅ 正常用户: ${totalNormal}`)
  if (totalGrace > 0) lines.push(`⏳ 宽限期内: ${totalGrace}`)
  if (totalExpired > 0) lines.push(`⚠️ 过期用户: ${totalExpired}`)
  if (totalInvalidOther > 0) lines.push(`❌ 其他无效: ${totalInvalidOther}`)
  if (totalPending > 0) lines.push(`🔍 待审核: ${totalPending}`)
  if (totalBanned > 0) lines.push(`🚫 已封禁: ${totalBanned}`)
  if (totalValidNotInGroup > 0) lines.push(`📭 有效未加群: ${totalValidNotInGroup}`)
  if (totalUnregistered > 0) lines.push(`👻 群内未注册: ${totalUnregistered}`)
  if (totalUnkQQ > 0) lines.push(`❓ 未绑定QQ: ${totalUnkQQ}`)

  return lines.join('\n')
}
