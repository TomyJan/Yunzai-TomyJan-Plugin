import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { dataPath } from '../data/system/pluginConstants.js'
import { sleepAsync } from './utils.js'

// 用户缓存文件路径
const USER_CACHE_FILE = path.join(dataPath, 'system/eduUserCache.json')

// 第三方 API 固定 Key ID
const MOE_KEY_ID = 'moe_thirdParty'

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
  return config.getConfig().eduAuth
}

/**
 * 发起 API 请求
 * @param {string} endpoint - API 端点路径
 * @param {object} data - 请求数据
 * @returns {Promise<object>} - { success: boolean, data?: any, message?: string, code?: number }
 */
async function apiRequest(endpoint, data = {}) {
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
  const body = JSON.stringify(data)
  const method = 'POST'

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
  tjLogger.debug(`[EDU] 请求数据: ${body}`)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
    })

    if (!response.ok) {
      const errMsg = `HTTP ${response.status} ${response.statusText}`
      tjLogger.error(`[EDU] API 请求失败: ${errMsg}`)
      return { success: false, message: errMsg }
    }

    const jsonData = await response.json()
    tjLogger.debug(`[EDU] API 响应: ${JSON.stringify(jsonData)}`)

    if (jsonData.code !== 0) {
      return {
        success: false,
        message: jsonData.message || '请求失败',
        code: jsonData.code,
      }
    }

    return { success: true, data: jsonData.data }
  } catch (error) {
    tjLogger.error(`[EDU] API 请求错误: ${error.message}`)
    return { success: false, message: error.message }
  }
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
 * 判断用户是否有效（可认证）
 * @param {object} userInfo - 用户信息
 * @returns {boolean}
 */
export function isUserValid(userInfo) {
  if (!userInfo) return false
  if (userInfo.status !== 'active') return false

  // 检查是否过期
  if (userInfo.expireAt) {
    const expireTime = new Date(userInfo.expireAt).getTime()
    const now = Date.now()
    if (expireTime < now) {
      // 已过期，检查宽限次数
      const graceAuthCount = userInfo.role?.graceAuthCount || 0
      const graceUsed = userInfo.graceUsed || 0
      if (graceUsed >= graceAuthCount) {
        return false // 宽限次数用尽
      }
    }
  }

  return true
}

/**
 * 获取用户无效原因
 * @param {object|null} userInfo - 用户信息
 * @returns {string} - 无效原因描述
 */
export function getInvalidReason(userInfo) {
  if (!userInfo) return '未注册或未绑定QQ'
  if (userInfo.status === 'pending') return '待审核'
  if (userInfo.status === 'banned') return '已封禁'
  if (userInfo.status !== 'active') return `状态异常(${userInfo.status})`

  if (userInfo.expireAt) {
    const expireTime = new Date(userInfo.expireAt).getTime()
    const now = Date.now()
    if (expireTime < now) {
      const graceAuthCount = userInfo.role?.graceAuthCount || 0
      const graceUsed = userInfo.graceUsed || 0
      if (graceUsed >= graceAuthCount) {
        return '已过期且宽限次数用尽'
      }
    }
  }

  return '未知原因'
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

  const cache = {
    items: result.data.items || {},
    unkQQUser: result.data.unkQQUser || 0,
    updateTime: Date.now(),
  }

  saveUserCache(cache)
  const count = Object.keys(cache.items).length
  tjLogger.info(`[EDU] 用户缓存刷新完成，共 ${count} 个用户`)

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
  // 此处的 messages 请与 ChinaNet-EDU-Login-Web packages/web/src/utils/format.ts 中 getStatusText 同步
  const messages = {
    0: '认证成功',
    1: '排队中',
    2: '认证中',
    10: '提交失败：IP 格式错误',
    11: '提交失败：校区暂不支持',
    20: '认证失败: 暂无可用端点',
    21: '认证失败: 已达尝试上限',
    22: '认证失败：电信系统返回未知错误',
    23: '认证失败: 任务超时',
    24: '系统错误',
  }
  return messages[taskCode] || `未知状态(${taskCode})`
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

  for (let i = 0; i < maxPolls; i++) {
    const result = await checkTask(taskId)

    if (!result.success) {
      tjLogger.warn(`[EDU] 第 ${i + 1} 次查询失败: ${result.message}`)
      await sleepAsync(pollInterval)
      continue
    }

    const taskInfo = result.data

    // 状态变化时回调
    if (onProgress && taskInfo.status !== lastStatus) {
      onProgress(taskInfo)
      lastStatus = taskInfo.status
    }

    if (taskInfo.status === 'success') {
      return {
        success: true,
        message: `认证成功！`,
        data: taskInfo,
      }
    }

    if (taskInfo.status === 'failed') {
      return {
        success: false,
        message: getTaskCodeMessage(taskInfo.taskCode),
        data: taskInfo,
      }
    }

    // queued 或 running，继续轮询
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
    activeUsers: [], // 正常用户（在群内且有效）
    invalidInGroup: [], // 无效但还在群内的用户
    notInGroup: [], // 有效但未加群的用户
    unkQQUser: refreshResult.unkQQUser || 0, // 未绑定 QQ 的用户数
  }

  // 遍历所有已绑定 QQ 的用户
  for (const [qq, userInfo] of Object.entries(allUsers)) {
    const isInGroup = groupMemberSet.has(qq)
    const isValid = isUserValid(userInfo)

    if (isInGroup && isValid) {
      result.activeUsers.push({ qq, ...userInfo })
    } else if (isInGroup && !isValid) {
      result.invalidInGroup.push({
        qq,
        ...userInfo,
        reason: getInvalidReason(userInfo),
      })
    } else if (!isInGroup && isValid) {
      result.notInGroup.push({ qq, ...userInfo })
    }
  }

  // 检查群内未注册用户
  result.unregisteredInGroup = []
  for (const member of groupMembers) {
    const qq = String(member.user_id)
    if (!allUsers[qq]) {
      result.unregisteredInGroup.push({
        qq,
        nickname: member.nickname || member.card || qq,
      })
    }
  }

  return { success: true, data: result }
}
