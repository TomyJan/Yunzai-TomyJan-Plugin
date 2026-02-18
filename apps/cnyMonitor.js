import plugin from '../../../lib/plugins/plugin.js'
import config from '../components/config.js'
import {
  getRoomInfo,
  getTimedTasks,
  getStatus,
  isPushGroup,
  fmtTimestamp,
  fmtSeconds,
} from '../model/cnyMonitor.js'

export class cnyMonitorApp extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: '[TJ插件]CNY监控',
      /** 功能描述 */
      dsc: 'B站春节活动福气值监控与推送',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 1000,
      rule: [
        {
          reg: '^#?cny\\s*(status|状态)$',
          fnc: 'cnyStatus',
        },
        {
          reg: '^#?cny\\s*(time|定时|定时奖?品?)$',
          fnc: 'cnyTimedList',
        },
        {
          reg: '^#?cny\\s*(\\d+)$',
          fnc: 'cnyRoomInfo',
        },
      ],
    })
  }

  /**
   * 检查是否在推送群内
   * @returns {boolean}
   */
  checkPushGroup() {
    if (!this.e.group_id) return false
    return isPushGroup(this.e.group_id)
  }

  /**
   * 指令: #cny status / #cny状态
   * 返回当前监控状态
   */
  async cnyStatus() {
    if (!this.checkPushGroup()) return false

    const cfg = config.getConfig()?.cnyMonitor
    if (!cfg?.enable) {
      await this.reply('CNY 监控功能未启用', true)
      return true
    }

    const st = getStatus()
    if (!st.running) {
      await this.reply('❌ CNY 监控未在运行\n请检查配置是否正确', true)
      return true
    }

    const uptimeStr = fmtSeconds(st.uptime)
    const lines = [
      '🎆 CNY 福气值监控状态',
      `⏱️ 运行时间: ${uptimeStr}`,
      `📡 扫描轮次: ${st.scanRound}${st.scanning ? ' (扫描中...)' : ''}`,
      `🏠 监控房间: ${st.roomCount}`,
      `👁️ 高频监控: ${st.hfCount}`,
      `⏰ 定时任务: ${st.timedCount}`,
      `📨 已推送: ${st.pushedCount}`,
    ]

    await this.reply(lines.join('\n'), false)
    return true
  }

  /**
   * 指令: #cny time / #cny定时
   * 列出所有定时奖品
   */
  async cnyTimedList() {
    if (!this.checkPushGroup()) return false

    const cfg = config.getConfig()?.cnyMonitor
    if (!cfg?.enable) {
      await this.reply('CNY 监控功能未启用', true)
      return true
    }

    const st = getStatus()
    if (!st.running) {
      await this.reply('❌ CNY 监控未在运行', true)
      return true
    }

    const tasks = getTimedTasks()
    if (tasks.length === 0) {
      await this.reply('暂无定时奖品数据, 请等待扫描完成', true)
      return true
    }

    // 按开抢时间排序
    tasks.sort((a, b) => a.bonusTime - b.bonusTime)

    const now = Date.now() / 1000
    const lines = [`⏰ 定时奖品列表 (共${tasks.length}个)`]

    for (const task of tasks) {
      const timeStr = fmtTimestamp(task.bonusTime)
      const timeLeft = task.bonusTime - now
      const leftStr =
        timeLeft > 0 ? `还有${Math.ceil(timeLeft / 60)}分钟` : '已过期'
      const thresholdMet = task.currentFortune >= task.limit
      const statusEmoji = thresholdMet ? '✅' : '❌'

      lines.push('')
      lines.push(`📺 ${task.roomName} (${task.roomId})`)
      lines.push(`🎁 ${task.bonusName} (x${task.bonusNum})`)
      lines.push(`📅 开抢: ${timeStr} (${leftStr})`)
      lines.push(
        `📊 门槛: ${task.limit.toLocaleString()} (当前: ${task.currentFortune.toLocaleString()}) ${statusEmoji}`,
      )
    }

    await this.reply(lines.join('\n'), false)
    return true
  }

  /**
   * 指令: #cny <room_id>
   * 列出指定直播间所有奖品信息
   */
  async cnyRoomInfo() {
    if (!this.checkPushGroup()) return false

    const cfg = config.getConfig()?.cnyMonitor
    if (!cfg?.enable) {
      await this.reply('CNY 监控功能未启用', true)
      return true
    }

    const st = getStatus()
    if (!st.running) {
      await this.reply('❌ CNY 监控未在运行', true)
      return true
    }

    const match = this.e.msg.match(/^#?cny\s*(\d+)$/)
    if (!match) return false
    const roomId = match[1]

    const room = getRoomInfo(roomId)
    if (!room) {
      await this.reply(
        `未找到房间 ${roomId} 的监控数据\n可能该房间不在活动中, 或等待下一轮扫描`,
        true,
      )
      return true
    }

    const lines = [`📺 房间 ${roomId}: ${room.name}`]
    lines.push(`📊 当前福气值: ${room.current.toLocaleString()}`)

    if (room.allSteps && room.allSteps.length > 0) {
      lines.push('')
      for (const step of room.allSteps) {
        const diff = step.limit - room.current
        const tag = step.isTimed ? '⏰' : '🎁'
        const timeStr = step.isTimed
          ? ` [开抢: ${fmtTimestamp(step.bonusTime)}]`
          : ''
        const status = diff <= 0 ? '✅ 已达标' : `还差 ${diff.toLocaleString()}`
        lines.push(`${tag} ${step.bonusName} (x${step.bonusNum})${timeStr}`)
        lines.push(`   门槛: ${step.limit.toLocaleString()} | ${status}`)
      }
    } else {
      lines.push('暂无奖品数据')
    }

    if (room.isFortuneTarget && isFinite(room.estTime)) {
      lines.push('')
      lines.push(
        `⏱️ 预估下一奖品到达: 约 ${Math.ceil(room.estTime / 60)} 分钟后`,
      )
    }

    lines.push('')
    lines.push(`🔗 https://live.bilibili.com/${roomId}`)

    await this.reply(lines.join('\n'), false)
    return true
  }
}
