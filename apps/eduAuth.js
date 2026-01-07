import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import {
  getUser,
  isUserValid,
  getInvalidReason,
  submitAuth,
  waitForAuthResult,
  getTaskCodeMessage,
  reportGroupMembers,
  refreshUserCache,
  analyzeUserStatus,
} from '../model/eduAuth.js'

export class eduAuthApp extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: '[TJ插件]EDU认证',
      /** 功能描述 */
      dsc: 'EDU WiFi 认证与群管理',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 1000,
      rule: [
        {
          reg: '^#?(edu|EDU)(上报|同步)((用户|群成?员)?(列表)?)?$',
          fnc: 'eduReportMembers',
        },
        {
          reg: '^#?(edu|EDU)检查((用户|群成?员)?(列表)?)?$',
          fnc: 'eduCheckUsers',
        },
        {
          reg: '^#?(edu|EDU)踢(无效|过期)?((用户|群成?员)?(列表)?)?$',
          fnc: 'eduKickInvalid',
        },
        {
          reg: '^#?(edu|EDU)(刷新|更新)(缓存)?$',
          fnc: 'eduRefreshCache',
        },
        {
          reg: '^#?(edu|EDU)(认证|登录|登陆)?[：: ]?(.*)$',
          fnc: 'eduAuthSubmit',
        },
      ],
    })
  }

  /**
   * 检查是否在管理群内（用于管理指令权限控制）
   * @returns {boolean}
   */
  isInAdminGroup() {
    const eduConfig = config.getConfig().eduAuth
    const adminGroup = eduConfig?.adminGroup
    if (!adminGroup) return false
    return this.e.group_id === adminGroup
  }

  /**
   * 格式化认证结果消息
   * @param {boolean} success - 是否成功
   * @param {string} message - 基础消息
   * @param {object} taskInfo - 任务信息
   * @returns {string} - 格式化后的消息
   */
  formatAuthResultMessage(success, message, taskInfo = {}) {
    const { attempts, provider, queuedTimeMs, executionTimeMs } = taskInfo

    const lines = [
      `${success ? `✅` : `❌`} ${message}${attempts ? `共尝试 ${attempts} 次` : ''}`,
    ]

    if (provider) {
      lines.push(`本次认证服务由 ${provider} 提供`)
    }

    if (success) {
      lines.push('稍等几秒或重连 WiFi 即可上网')
    }

    if (queuedTimeMs || executionTimeMs) {
      lines.push('\n')
      const timeDetails = []
      if (queuedTimeMs) {
        timeDetails.push(`排队 ${(queuedTimeMs / 1000).toFixed(1)}s`)
      }
      if (executionTimeMs) {
        timeDetails.push(`执行 ${(executionTimeMs / 1000).toFixed(1)}s`)
      }
      lines.push(timeDetails.join(' | '))
    }

    return lines.join('\n')
  }

  /**
   * EDU 认证提交
   */
  async eduAuthSubmit() {
    // 一些预检
    if (!config.getConfig().eduAuth?.enable) {
      await this.reply('EDU 认证 功能未启用', true)
      return
    }

    // 提取 IP 地址
    let content = this.e.msg
      .replace(/#?(edu|EDU)(认证|登录|登陆)?[：: ]?/g, '')
      .trim()

    if (!content) {
      await this.reply('你的 IP 呢?', true)
      return
    }
    const ipRegex =
      /\b100\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/
    const match = content.match(ipRegex)
    if (!match) {
      tjLogger.debug(
        `[EDU] 用户 ${this.e.user_id} 提交的 IP 格式不正确: ${content}`,
      )
      await this.reply('你要不看看你发的 IP 对不对呢?', true)
      return
    }
    const authIp = match[0]

    // 获取用户 QQ
    const userQQ = String(this.e.user_id)
    tjLogger.info(`[EDU] 用户 ${userQQ} 请求认证 IP: ${authIp}`)

    // 查询用户信息
    const userResult = await getUser(userQQ, true) // 强制刷新获取最新状态

    if (!userResult.success) {
      tjLogger.warn(`[EDU] 用户 ${userQQ} 获取信息失败: ${userResult.message}`)
      await this.reply(`获取用户信息失败: ${userResult.message}`, true)
      return
    }

    const userInfo = userResult.data
    tjLogger.debug(
      `[EDU] 用户 ${userQQ} 信息: status=${userInfo.status}, expireAt=${userInfo.expireAt}`,
    )

    // 检查用户是否有效
    if (!isUserValid(userInfo)) {
      const reason = getInvalidReason(userInfo)
      tjLogger.info(`[EDU] 用户 ${userQQ} 账号无效: ${reason}`)
      await this.reply(`您的账号无效: ${reason}`, true)
      return
    }

    // 提交认证任务
    tjLogger.info(
      `[EDU] 用户 ${userQQ} (userId: ${userInfo.id}) 开始提交认证任务`,
    )
    await this.reply(`用户验证通过，正在提交认证任务...\nIP: ${authIp}`, true)

    const submitResult = await submitAuth(userInfo.id, authIp)

    if (!submitResult.success) {
      tjLogger.warn(
        `[EDU] 用户 ${userQQ} 提交认证失败: ${submitResult.message}`,
      )
      await this.reply(`提交认证任务失败: ${submitResult.message}`, true)
      return
    }

    const taskInfo = submitResult.data
    const taskId = taskInfo.taskId
    tjLogger.info(
      `[EDU] 用户 ${userQQ} 任务已提交, taskId: ${taskId}, status: ${taskInfo.status}`,
    )

    // 如果已经是最终状态
    if (taskInfo.status === 'success') {
      const msg = this.formatAuthResultMessage(true, '认证成功！', taskInfo)
      await this.reply(msg, true)
      return
    }

    if (taskInfo.status === 'failed') {
      const msg = this.formatAuthResultMessage(
        false,
        getTaskCodeMessage(taskInfo.taskCode),
        taskInfo,
      )
      await this.reply(msg, true)
      return
    }

    // 显示队列信息
    let queueMsg = '任务已提交, 正在认证中...'
    if (taskInfo.isExisting) {
      queueMsg = '任务已存在，将继续查询进度'
    }
    if (taskInfo.position) {
      queueMsg += `\n排队中, 当前第 ${taskInfo.position} 位`
    }
    await this.reply(queueMsg, true)

    // 等待认证结果
    const finalResult = await waitForAuthResult(taskId)
    tjLogger.info(
      `[EDU] 用户 ${userQQ} 认证结果: ${finalResult.success ? '成功' : '失败'} - ${finalResult.message}`,
    )

    const resultMsg = this.formatAuthResultMessage(
      finalResult.success,
      finalResult.message,
      finalResult.data || {},
    )
    await this.reply(resultMsg, true)
  }

  /**
   * 上报群成员（仅管理群可用）
   */
  async eduReportMembers() {
    if (!config.getConfig().eduAuth?.enable) {
      await this.reply('EDU 认证 功能未启用', true)
      return
    }

    // 仅管理群可触发
    if (!this.isInAdminGroup()) {
      return
    }

    tjLogger.info(`[EDU] 管理员 ${this.e.user_id} 触发群成员上报`)

    const eduConfig = config.getConfig().eduAuth
    const userGroup = eduConfig.userGroup

    if (!userGroup) {
      await this.reply('未配置用户群群号', true)
      return
    }

    await this.reply('正在获取群成员列表...', true)

    try {
      // eslint-disable-next-line no-undef
      const group = Bot.pickGroup(userGroup)
      const memberMap = await group.getMemberMap()

      if (!memberMap || memberMap.size === 0) {
        await this.reply('获取群成员列表失败或群为空', true)
        return
      }

      const qqList = Array.from(memberMap.keys()).map(String)
      tjLogger.info(`[EDU] 获取到群 ${userGroup} 成员 ${qqList.length} 人`)

      const result = await reportGroupMembers(qqList)

      if (result.success) {
        await this.reply(
          `群成员上报成功\n上报人数: ${result.data.memberCount}`,
          true,
        )
      } else {
        await this.reply(`群成员上报失败: ${result.message}`, true)
      }
    } catch (error) {
      tjLogger.error(`[EDU] 获取群成员失败: ${error.message}`)
      await this.reply(`获取群成员失败: ${error.message}`, true)
    }
  }

  /**
   * 检查用户状态（仅管理群可用）
   */
  async eduCheckUsers() {
    if (!config.getConfig().eduAuth?.enable) {
      await this.reply('EDU 认证 功能未启用', true)
      return
    }

    // 仅管理群可触发
    if (!this.isInAdminGroup()) {
      return
    }

    tjLogger.info(`[EDU] 管理员 ${this.e.user_id} 触发用户状态检查`)

    const eduConfig = config.getConfig().eduAuth
    const userGroup = eduConfig.userGroup

    if (!userGroup) {
      await this.reply('未配置用户群群号', true)
      return
    }

    await this.reply('正在分析用户状态，请稍候...', true)

    try {
      // eslint-disable-next-line no-undef
      const group = Bot.pickGroup(userGroup)
      const memberMap = await group.getMemberMap()

      if (!memberMap) {
        await this.reply('获取群成员列表失败', true)
        return
      }

      const groupMembers = Array.from(memberMap.entries()).map(
        ([user_id, info]) => ({
          user_id,
          nickname: info.nickname || info.card || String(user_id),
        }),
      )

      const result = await analyzeUserStatus(groupMembers)

      if (!result.success) {
        await this.reply(`分析失败: ${result.message}`, true)
        return
      }

      const data = result.data

      // 构造转发消息
      const forwardMsgs = []
      // eslint-disable-next-line no-undef
      const botQQ = config.getConfig().botQQ || Bot.uin

      // 概览
      forwardMsgs.push({
        user_id: botQQ,
        nickname: 'EDU用户检查',
        message: [
          `📊 用户状态概览\n`,
          `✅ 正常用户: ${data.activeUsers.length}\n`,
          `❌ 无效在群内: ${data.invalidInGroup.length}\n`,
          `📭 有效未加群: ${data.notInGroup.length}\n`,
          `❓ 未绑定QQ: ${data.unkQQUser}\n`,
          `👻 群内未注册: ${data.unregisteredInGroup.length}`,
        ].join(''),
      })

      // 无效但在群内的用户
      if (data.invalidInGroup.length > 0) {
        const list = data.invalidInGroup
          .map((u) => `${u.qq} - ${u.reason}`)
          .join('\n')
        forwardMsgs.push({
          user_id: botQQ,
          nickname: '❌ 无效在群内用户',
          message: '❌ 无效在群内用户\n' + list,
        })
      }

      // 有效但未加群的用户
      if (data.notInGroup.length > 0) {
        const list = data.notInGroup.map((u) => u.qq).join('\n')
        forwardMsgs.push({
          user_id: botQQ,
          nickname: '📭 有效未加群用户',
          message: '📭 有效未加群用户\n' + list,
        })
      }

      // 群内未注册用户（取前50个）
      if (data.unregisteredInGroup.length > 0) {
        const showList = data.unregisteredInGroup.slice(0, 50)
        const list = showList.map((u) => `${u.qq} (${u.nickname})`).join('\n')
        const extra =
          data.unregisteredInGroup.length > 50
            ? `\n... 等共 ${data.unregisteredInGroup.length} 人`
            : ''
        forwardMsgs.push({
          user_id: botQQ,
          nickname: '👻 群内未注册用户',
          message: '👻 群内未注册用户\n' + list + extra,
        })
      }

      // 发送转发消息
      // eslint-disable-next-line no-undef
      const forwardMsg = await Bot.makeForwardMsg(forwardMsgs)
      await this.reply(forwardMsg)
    } catch (error) {
      tjLogger.error(`[EDU] 检查用户失败: ${error.message}`)
      await this.reply(`检查用户失败: ${error.message}`, true)
    }
  }

  /**
   * 踢出无效用户（仅管理群可用）
   */
  async eduKickInvalid() {
    if (!config.getConfig().eduAuth?.enable) {
      await this.reply('EDU 认证 功能未启用', true)
      return
    }

    // 仅管理群可触发
    if (!this.isInAdminGroup()) {
      return
    }

    tjLogger.info(`[EDU] 管理员 ${this.e.user_id} 触发踢出无效用户`)

    const eduConfig = config.getConfig().eduAuth
    const userGroup = eduConfig.userGroup

    if (!userGroup) {
      await this.reply('未配置用户群群号', true)
      return
    }

    await this.reply('正在分析无效用户...', true)

    try {
      // eslint-disable-next-line no-undef
      const group = Bot.pickGroup(userGroup)
      const memberMap = await group.getMemberMap()

      if (!memberMap) {
        await this.reply('获取群成员列表失败', true)
        return
      }

      const groupMembers = Array.from(memberMap.entries()).map(
        ([user_id, info]) => ({
          user_id,
          nickname: info.nickname || info.card || String(user_id),
        }),
      )

      const result = await analyzeUserStatus(groupMembers)

      if (!result.success) {
        await this.reply(`分析失败: ${result.message}`, true)
        return
      }

      // 合并无效用户和未注册用户
      const invalidUsers = result.data.invalidInGroup.map((u) => ({
        qq: u.qq,
        reason: u.reason,
      }))
      const unregisteredUsers = result.data.unregisteredInGroup.map((u) => ({
        qq: u.qq,
        reason: '未注册',
      }))
      const allInvalidUsers = [...invalidUsers, ...unregisteredUsers]

      if (allInvalidUsers.length === 0) {
        await this.reply('没有需要踢出的无效用户', true)
        return
      }

      await this.reply(
        `发现 ${allInvalidUsers.length} 个需踢出用户\n` +
          `- 无效用户: ${invalidUsers.length}\n` +
          `- 未注册用户: ${unregisteredUsers.length}\n` +
          `开始踢出...`,
        true,
      )

      let kickedCount = 0
      let failedCount = 0

      for (const user of allInvalidUsers) {
        try {
          const kickResult = await group.kickMember(Number(user.qq))
          if (kickResult) {
            kickedCount++
            tjLogger.info(`[EDU] 已踢出用户 ${user.qq}: ${user.reason}`)
          } else {
            failedCount++
            tjLogger.warn(`[EDU] 踢出用户 ${user.qq} 失败: 操作返回失败`)
          }
        } catch (error) {
          failedCount++
          tjLogger.warn(`[EDU] 踢出用户 ${user.qq} 失败: ${error.message}`)
        }
      }

      await this.reply(
        `踢出完成\n成功: ${kickedCount}\n失败: ${failedCount}`,
        true,
      )
    } catch (error) {
      tjLogger.error(`[EDU] 踢出无效用户失败: ${error.message}`)
      await this.reply(`踢出无效用户失败: ${error.message}`, true)
    }
  }

  /**
   * 刷新用户缓存（仅管理群可用）
   */
  async eduRefreshCache() {
    if (!config.getConfig().eduAuth?.enable) {
      await this.reply('EDU 认证功能未启用', true)
      return
    }

    // 仅管理群可触发
    if (!this.isInAdminGroup()) {
      return
    }

    tjLogger.info(`[EDU] 管理员 ${this.e.user_id} 触发刷新用户缓存`)

    await this.reply('正在刷新用户缓存...', true)

    const result = await refreshUserCache()

    if (result.success) {
      await this.reply(
        `缓存刷新成功\n已绑定QQ用户: ${result.count}\n未绑定QQ用户: ${result.unkQQUser}`,
        true,
      )
    } else {
      await this.reply(`缓存刷新失败: ${result.message}`, true)
    }
  }
}

// ==================== 群事件监听 ====================

/**
 * 处理群成员变动事件
 * @param {object} e - 事件对象
 */
async function handleGroupMemberChange(e) {
  const eduConfig = config.getConfig().eduAuth
  if (!eduConfig?.enable) return

  const userGroup = eduConfig.userGroup
  const adminGroup = eduConfig.adminGroup
  if (!userGroup || e.group_id !== userGroup) return

  const changeType =
    e.sub_type === 'increase'
      ? '加入'
      : e.sub_type === 'decrease'
        ? '退出'
        : `未知(${e.sub_type})`
  tjLogger.info(`[EDU] 群成员变动: ${e.user_id} ${changeType}`)

  // 延迟一秒后上报，避免频繁调用
  setTimeout(async () => {
    let reportResult = null
    let reportError = null

    try {
      // eslint-disable-next-line no-undef
      const group = Bot.pickGroup(userGroup)
      const memberMap = await group.getMemberMap()

      if (!memberMap) {
        reportError = '获取群成员列表失败'
      } else {
        const qqList = Array.from(memberMap.keys()).map(String)
        reportResult = await reportGroupMembers(qqList)
      }
    } catch (error) {
      tjLogger.error(`[EDU] 群成员变动上报失败: ${error.message}`)
      reportError = error.message
    }

    // 在管理群通知变动事件和上报结果
    if (adminGroup) {
      try {
        // eslint-disable-next-line no-undef
        const adminGroupObj = Bot.pickGroup(adminGroup)
        let notifyMsg = `📢 群成员变动\n${e.user_id} ${changeType} 了群`

        if (reportError) {
          notifyMsg += `\n\n❌ 上报失败: ${reportError}`
        } else if (reportResult?.success) {
          notifyMsg += `\n\n✅ 上报成功`
        } else {
          notifyMsg += `\n\n❌ 上报失败: ${reportResult?.message || '未知错误'}`
        }

        await adminGroupObj.sendMsg(notifyMsg)
      } catch (error) {
        tjLogger.error(`[EDU] 发送管理群通知失败: ${error.message}`)
      }
    }
  }, 1000)
}

/**
 * 处理加群申请
 * @param {object} e - 事件对象
 */
async function handleGroupRequest(e) {
  const eduConfig = config.getConfig().eduAuth
  if (!eduConfig?.enable) return

  const userGroup = eduConfig.userGroup
  const adminGroup = eduConfig.adminGroup
  if (!userGroup || e.group_id !== userGroup) return

  const userQQ = String(e.user_id)
  tjLogger.info(`[EDU] 收到加群申请: ${userQQ}`)

  // 查询用户信息（先查缓存，无则从 API 获取）
  const userResult = await getUser(userQQ)

  let notifyMsg = ''

  if (userResult.success && isUserValid(userResult.data)) {
    // 有效用户，自动批准
    try {
      const approveResult = await e.approve(true)
      if (approveResult) {
        tjLogger.info(`[EDU] 自动批准用户 ${userQQ} 加群`)
        notifyMsg =
          `✅ 新加群申请 - 已自动批准\n` +
          `QQ: ${userQQ}\n` +
          `用户: ${userResult.data.username || '未知'}\n` +
          `申请消息: ${e.comment || '无'}`
      } else {
        tjLogger.error(`[EDU] 自动批准用户 ${userQQ} 失败: 操作返回失败`)
        notifyMsg =
          `❌ 新加群申请 - 待手动审核\n` +
          `QQ: ${userQQ}\n` +
          `用户: ${userResult.data.username || '未知'}\n` +
          `申请消息: ${e.comment || '无'}\n` +
          `用户有效, 但自动批准失败, 请手动审核`
      }
    } catch (error) {
      tjLogger.error(`[EDU] 自动批准失败: ${error.message}`)
      notifyMsg =
        `❌ 新加群申请 - 待手动审核\n` +
        `QQ: ${userQQ}\n` +
        `用户: ${userResult.data.username || '未知'}\n` +
        `申请消息: ${e.comment || '无'}\n` +
        `错误: ${error.message}\n\n` +
        `用户有效, 但自动批准失败, 请手动审核`
    }
  } else {
    // 无效用户，发送提示到管理群
    const reason = userResult.success
      ? getInvalidReason(userResult.data)
      : userResult.message

    notifyMsg =
      `⚠️ 新加群申请 - 待手动审核\n` +
      `QQ: ${userQQ}\n` +
      `状态: ${reason}\n` +
      `申请消息: ${e.comment || '无'}\n\n` +
      `无法验证用户状态, 请手动审核`
  }

  // 统一发送管理群通知
  if (adminGroup && notifyMsg) {
    try {
      // eslint-disable-next-line no-undef
      const adminGroupObj = Bot.pickGroup(adminGroup)
      await adminGroupObj.sendMsg(notifyMsg)
    } catch (error) {
      tjLogger.error(`[EDU] 发送管理群通知失败: ${error.message}`)
    }
  }
}

// 注册事件监听
if (typeof Bot !== 'undefined') {
  // eslint-disable-next-line no-undef
  Bot.on?.('notice.group.increase', handleGroupMemberChange)
  // eslint-disable-next-line no-undef
  Bot.on?.('notice.group.decrease', handleGroupMemberChange)
  // eslint-disable-next-line no-undef
  Bot.on?.('request.group.add', handleGroupRequest)
}
