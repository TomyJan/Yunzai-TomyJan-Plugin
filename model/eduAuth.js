import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import crypto from 'crypto'

/**
 * 计算 MD5 值
 * @param {string} str - 待计算 MD5 的字符串
 * @returns {string} - MD5 值
 */
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

/**
 * 提交 API 请求
 * @param {string} apiName - API 名称, aclist/submit/query
 * @param {object} data - API 请求数据, submit 时为 { ip: string, acIndex: number }, query 时为 { ip: string }
 * @returns {Promise<object>} - API 响应, success 为 true 时, data 为 API 响应数据, success 为 false 时, message 为错误信息
 */
export async function submitApiRequest(apiName, data) {
  tjLogger.debug(`提交 API 请求: ${apiName}, 数据: ${JSON.stringify(data)}`)
  const ApiBaseUrl = config.getConfig().eduAuth.apiBaseUrl
  const ApiKey = config.getConfig().eduAuth.apiKey
  if (!ApiBaseUrl || !ApiKey || ApiKey.split('|').length !== 2) {
    tjLogger.error(`API 配置错误: apiBaseUrl=${ApiBaseUrl}, apiKey=${ApiKey}`)
    return { success: false, message: 'API 配置不完整或有误' }
  }

  if (!['aclist', 'submit', 'query'].includes(apiName)) {
    tjLogger.error(`API 名称错误: apiName=${apiName}`)
    return { success: false, message: `API 名称 ${apiName} 错误` }
  }

  let url = ApiBaseUrl
  let method = 'POST'
  if (apiName === 'aclist') {
    url += 'ac/list'
    method = 'GET'
  } else if (apiName === 'submit') {
    url += 'login/submit'
  } else if (apiName === 'query') {
    url += 'login/query'
  }

  // 准备签名所需数据
  const [userId, secretKey] = ApiKey.split('|')
  const timestamp = Math.floor(Date.now() / 1000).toString() // 当前秒时间戳
  const sign = md5(secretKey + '|' + timestamp)

  // 设置请求头
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `moe_user_id=${userId}; moe_time=${timestamp}; moe_sign=${sign}`
  }

  tjLogger.debug(`API 请求地址: ${url}, 方法: ${method}, 数据: ${JSON.stringify(data)}`)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(data) : undefined
    })

    if (!response.ok) {
      const errMsg = `API 请求失败: ${response.status} ${response.statusText}`
      tjLogger.error(errMsg)
      return { success: false, message: errMsg }
    }

    const jsonData = await response.json()

    if (jsonData.code !== 0) {
      const errMsg = `API 请求失败: ${jsonData.code} ${jsonData.msg}`
      tjLogger.error(errMsg)
      return { success: false, message: errMsg }
    }

    return { success: true, data: jsonData }
  } catch (error) {
    const errMsg = `API 请求错误: ${error.message}`
    tjLogger.error(errMsg)
    return { success: false, message: error.message }
  }
}
