import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { dataPath } from '../data/system/pluginConstants.js'
import { withProxy } from './proxy.js'
import {
  categorizeUserStatus,
  formatDateUTC8,
  formatUserStatusReport,
  getGracePeriodInfo,
  getInvalidReason,
  getUserStatus,
  isUserValid,
  resolveTaskResult as resolveTaskResultRule,
} from './eduAuthRules.js'

export {
  formatDateUTC8,
  formatUserStatusReport,
  getGracePeriodInfo,
  getInvalidReason,
  getUserStatus,
  isUserValid,
}

function sleepAsync(sleepms) {
  return new Promise((resolve) => {
    setTimeout(resolve, sleepms)
  })
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
  let timestamp
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
  const pluginConfig = config.getConfig()
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

    const response = await fetch(
      url,
      withProxy(fetchOptions, pluginConfig, cfg.proxy?.enable, {
        feature: 'EDU 认证',
        warn: (message) => tjLogger.warn(message),
      }),
    )

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
  const fallbackMessage =
    taskInfo.taskCode !== undefined
      ? getTaskCodeMessage(taskInfo.taskCode)
      : null
  return resolveTaskResultRule(taskInfo, metadata, fallbackMessage)
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
  try {
    const result = categorizeUserStatus({
      allUsers,
      groupMembers,
      unkQQUser: refreshResult.unkQQUser,
      onInvalidUser: (qq) => tjLogger.warn(`[EDU] 跳过异常用户数据: ${qq}`),
    })
    return { success: true, data: result }
  } catch (error) {
    tjLogger.error(`[EDU] 分析用户状态时出错: ${error.message}`)
    return {
      success: false,
      message: `分析用户状态失败: ${error.message}`,
    }
  }
}
