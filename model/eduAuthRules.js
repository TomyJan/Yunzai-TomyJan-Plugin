const MS_PER_DAY = 24 * 60 * 60 * 1000

function parseUTCDate(dateStr) {
  if (!dateStr) return new Date(NaN)
  if (/Z|[+-]\d{2}:\d{2}$/.test(dateStr)) return new Date(dateStr)
  return new Date(`${dateStr}Z`)
}

export function formatDateUTC8(date, includeTime = true) {
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const year = utc8.getUTCFullYear()
  const month = String(utc8.getUTCMonth() + 1).padStart(2, '0')
  const day = String(utc8.getUTCDate()).padStart(2, '0')
  if (!includeTime) return `${year}.${month}.${day}`

  const hour = String(utc8.getUTCHours()).padStart(2, '0')
  const minute = String(utc8.getUTCMinutes()).padStart(2, '0')
  return `${year}.${month}.${day} ${hour}:${minute}`
}

export function getUserStatus(userInfo, now = Date.now()) {
  if (!userInfo || typeof userInfo !== 'object') return 'unknown'
  if (userInfo.status === 'pending') return 'pending'
  if (userInfo.status === 'banned') return 'banned'
  if (userInfo.status === 'disabled') return 'disabled'
  if (userInfo.status !== 'active') return 'unknown'
  if (!userInfo.expireAt) return 'active'

  const expireTime = parseUTCDate(userInfo.expireAt).getTime()
  if (Number.isNaN(expireTime)) return 'unknown'
  if (expireTime >= now) return 'active'

  const graceDays = userInfo.role?.graceDays || 0
  const graceAuthCount = userInfo.role?.graceAuthCount || 0
  const graceUsed = userInfo.graceUsed || 0
  if (
    graceAuthCount > 0 &&
    graceUsed < graceAuthCount &&
    expireTime + graceDays * MS_PER_DAY > now
  ) {
    return 'grace_period'
  }
  return 'expired'
}

export function getGracePeriodInfo(userInfo, now = Date.now()) {
  if (!userInfo) return { isInGracePeriod: false }
  if (!userInfo.expireAt) {
    return { isInGracePeriod: false, daysRemaining: Infinity }
  }

  const expireTime = parseUTCDate(userInfo.expireAt).getTime()
  if (Number.isNaN(expireTime)) return { isInGracePeriod: false }
  if (expireTime >= now) {
    return {
      isInGracePeriod: false,
      daysRemaining: Math.ceil((expireTime - now) / MS_PER_DAY),
    }
  }

  const graceAuthCount = userInfo.role?.graceAuthCount || 0
  const graceDays = userInfo.role?.graceDays || 0
  const graceUsed = userInfo.graceUsed || 0
  const usesRemaining = Math.max(0, graceAuthCount - graceUsed)
  const expiredDaysAgo = Math.floor((now - expireTime) / MS_PER_DAY)
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

export function isUserValid(userInfo, now = Date.now()) {
  const status = getUserStatus(userInfo, now)
  return status === 'active' || status === 'grace_period'
}

export function getInvalidReason(userInfo, now = Date.now()) {
  const status = getUserStatus(userInfo, now)

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
      const graceInfo = getGracePeriodInfo(userInfo, now)
      return `已过期 (${graceInfo.expiredDaysAgo}天前)`
    }
    case 'grace_period':
      return '宽限期内'
    case 'active':
    default:
      return '正常'
  }
}

export function resolveTaskResult(
  taskInfo = {},
  metadata = null,
  fallbackMessage = null,
) {
  const message =
    taskInfo.message || metadata?.defaultMessage || fallbackMessage || null

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

function emptyUserCategories(unkQQUser) {
  return {
    normalUsers: [],
    gracePeriodUsers: [],
    expiredUsers: [],
    pendingUsers: [],
    bannedUsers: [],
    disabledUsers: [],
    invalidInGroup: [],
    validNotInGroup: [],
    unregisteredInGroup: [],
    unkQQUser: unkQQUser || 0,
  }
}

export function categorizeUserStatus({
  allUsers = {},
  groupMembers = [],
  unkQQUser = 0,
  now = Date.now(),
  onInvalidUser,
}) {
  const members = Array.isArray(groupMembers) ? groupMembers : []
  const groupMemberSet = new Set(
    members.map((member) => String(member.user_id)),
  )
  const result = emptyUserCategories(unkQQUser)

  for (const [qq, userInfo] of Object.entries(allUsers || {})) {
    if (!userInfo || typeof userInfo !== 'object') {
      onInvalidUser?.(qq)
      continue
    }

    const status = getUserStatus(userInfo, now)
    if (!groupMemberSet.has(qq)) {
      if (status === 'active' || status === 'grace_period') {
        result.validNotInGroup.push({ qq, ...userInfo, status })
      }
      continue
    }

    switch (status) {
      case 'active':
        result.normalUsers.push({ qq, ...userInfo })
        break
      case 'grace_period':
        result.gracePeriodUsers.push({
          qq,
          ...userInfo,
          graceInfo: getGracePeriodInfo(userInfo, now),
        })
        break
      case 'expired':
        result.expiredUsers.push({
          qq,
          ...userInfo,
          graceInfo: getGracePeriodInfo(userInfo, now),
        })
        break
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
          reason: getInvalidReason(userInfo, now),
        })
    }
  }

  for (const member of members) {
    const qq = String(member.user_id)
    if (!allUsers?.[qq]) {
      result.unregisteredInGroup.push({
        qq,
        nickname: member.nickname || member.card || qq,
      })
    }
  }

  return result
}

function categorySize(data, key) {
  return Array.isArray(data[key]) ? data[key].length : 0
}

export function formatUserStatusReport(analysisResult) {
  if (!analysisResult?.success || !analysisResult.data) {
    return '获取用户状态失败'
  }

  const data = analysisResult.data
  if (typeof data !== 'object' || Array.isArray(data)) {
    return '用户状态数据格式错误'
  }

  const lines = ['📊 用户状态概览\n']
  const categories = [
    ['normalUsers', '✅ 正常用户'],
    ['gracePeriodUsers', '⏳ 宽限期内'],
    ['expiredUsers', '⚠️ 过期用户'],
    ['disabledUsers', '⏹️ 已停用'],
    ['invalidInGroup', '❌ 其他无效'],
    ['pendingUsers', '🔍 待审核'],
    ['bannedUsers', '🚫 已封禁'],
    ['validNotInGroup', '📭 有效未加群'],
    ['unregisteredInGroup', '👻 群内未注册'],
  ]

  for (const [key, label] of categories) {
    const count = categorySize(data, key)
    if (count > 0) lines.push(`${label}: ${count}`)
  }
  if (data.unkQQUser > 0) lines.push(`❓ 未绑定QQ: ${data.unkQQUser}`)

  return lines.join('\n')
}
