import fetch from 'node-fetch'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import { sendMsgFriend } from './utils.js'
import cfg from '../../../lib/config/config.js'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  API 常量
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TAB_API =
  'https://api.bilibili.com/x/project/cny/v3/tab/view?build=8820400&mobi_app=android&chat_room_page='
const TASK_API =
  'https://api.bilibili.com/x/custom_activity/cny/2026/live/task?room_id='
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  共享状态 (单例)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 错误记录窗口 (5分钟) */
const ERROR_WINDOW_MS = 5 * 60 * 1000
/** 5分钟内错误数 >= 此值时推送主人 */
const ERROR_ALERT_THRESHOLD = 20

class CnyState {
  constructor() {
    this.running = false
    /** @type {Object<string, object>} 房间数据 */
    this.rooms = {}
    /** @type {Set<string>} 高频监控集合 */
    this.hfSet = new Set()
    /** @type {Object<string, object>} 定时任务 key=sub_task_id */
    this.timedTasks = {}
    /** @type {Set<string>} 已推送去重键 */
    this.pushedSet = new Set()
    this.scanRound = 0
    this.scanning = false
    this.startTime = 0
    this._slowTimer = null
    this._hfTimer = null
    /** @type {Array<{ts: number, msg: string}>} 最近错误记录 */
    this.errors = []
    /** 上次错误告警推送时间戳 */
    this._lastErrorAlertTs = 0
  }

  reset() {
    this.rooms = {}
    this.hfSet = new Set()
    this.timedTasks = {}
    this.pushedSet = new Set()
    this.scanRound = 0
    this.scanning = false
    this.errors = []
  }
}

export const cnyState = new CnyState()

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  辅助函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 获取 cnyMonitor 配置
 * @returns {object}
 */
function getCfg() {
  return config.getConfig()?.cnyMonitor || {}
}

/**
 * 解析推送群列表 (兼容字符串和数组)
 * @returns {number[]}
 */
function getPushGroups() {
  const raw = getCfg().pushGroups
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(Number).filter(Boolean)
  return String(raw)
    .split(/[,，\s]+/)
    .map(Number)
    .filter(Boolean)
}

/**
 * 获取请求头
 * @returns {object}
 */
function getHeaders() {
  const cookie = getCfg().cookie || ''
  return {
    'User-Agent': UA,
    Cookie: cookie,
    Referer: 'https://live.bilibili.com/',
  }
}

/**
 * 记录一条错误并检查是否需要告警
 * @param {string} msg 错误摘要
 */
function recordError(msg) {
  const now = Date.now()
  cnyState.errors.push({ ts: now, msg })
  // 清理窗口外的旧记录
  cnyState.errors = cnyState.errors.filter((e) => now - e.ts < ERROR_WINDOW_MS)
  // 频繁错误告警 (5分钟内冷却)
  if (
    cnyState.errors.length >= ERROR_ALERT_THRESHOLD &&
    now - cnyState._lastErrorAlertTs > ERROR_WINDOW_MS
  ) {
    cnyState._lastErrorAlertTs = now
    const alertMsg =
      `[TJ插件] CNY监控异常告警\n` +
      `近5分钟错误${cnyState.errors.length}次\n` +
      `最近: ${msg}\n` +
      `请检查 Cookie 或网络状态`
    sendMsgFriend(cfg.masterQQ[0], alertMsg)
    tjLogger.warn(
      `CNY: 频繁错误告警已推送主人 (${cnyState.errors.length}次/5min)`,
    )
  }
}

/**
 * 解析阶段配置 (兼容数组和逗号分隔字符串, 降序排列)
 * @param {Array|string} raw 配置原始值
 * @param {number[]} defaults 默认阶段
 * @returns {number[]} 降序排列的阶段数组
 */
function parseStageCfg(raw, defaults) {
  let arr = defaults
  if (Array.isArray(raw) && raw.length > 0) {
    arr = raw.map(Number).filter((n) => n > 0)
  } else if (typeof raw === 'string' && raw.trim()) {
    arr = raw
      .split(/[,，\s]+/)
      .map(Number)
      .filter((n) => n > 0)
  }
  // 降序排列: 从大到小, 先检查最宽松阶段
  return arr.sort((a, b) => b - a)
}

/**
 * 分批并行执行异步任务
 * @param {Array} items 待处理项
 * @param {Function} fn 异步处理函数
 * @param {number} concurrency 并发数
 * @returns {Promise<Array>}
 */
async function parallelMap(items, fn, concurrency = 15) {
  const results = []
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    const chunkResults = await Promise.allSettled(chunk.map(fn))
    results.push(...chunkResults)
  }
  return results
}

/**
 * 基于历史数据线性回归计算预估到达时间(秒)
 * @param {Array<[number, number]>} history [timestamp, value] 对
 * @param {number} current 当前值
 * @param {number} target 目标值
 * @returns {number} 预估秒数, Infinity 表示无法预估
 */
function calcEstTime(history, current, target) {
  if (history.length < 2 || current >= target) return Infinity
  const [t0, v0] = history[0]
  const [t1, v1] = history[history.length - 1]
  const dt = t1 - t0
  if (dt < 0.5) return Infinity
  const rate = (v1 - v0) / dt
  if (rate <= 0) return Infinity
  return Math.max(0, (target - current) / rate)
}

/**
 * 秒 → 人类可读时间
 * @param {number} seconds
 * @returns {string}
 */
export function fmtSeconds(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--'
  const s = Math.floor(seconds)
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  }
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/**
 * 时间戳(秒) → MM.DD HH:MM
 * @param {number} ts 时间戳(秒)
 * @returns {string}
 */
export function fmtTimestamp(ts) {
  try {
    const d = new Date(ts * 1000)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${mm}.${dd} ${hh}:${mi}`
  } catch {
    return '--.-- --:--'
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  API 请求
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 获取 Tab 页房间列表
 * @param {number} page 页码
 * @returns {Promise<Object<string, string>>} {room_id: room_name}
 */
async function fetchTabPage(page) {
  try {
    const resp = await fetch(`${TAB_API}${page}`, {
      headers: getHeaders(),
      timeout: 8000,
    })
    if (!resp.ok) {
      const errMsg = `TabPage(${page}) HTTP ${resp.status}`
      tjLogger.debug(`CNY: ${errMsg}`)
      recordError(errMsg)
      return {}
    }
    const d = await resp.json()
    if (d.code !== 0) {
      const errMsg = `TabPage(${page}) code=${d.code}`
      tjLogger.debug(`CNY: ${errMsg}`)
      recordError(errMsg)
      return {}
    }
    const out = {}
    for (const sec of d.data?.tab_sections || []) {
      if (sec.section_type !== 'tab_section_chat_room_list') continue
      for (const rm of sec.chat_room_list?.live_chat_rooms || []) {
        const jump = rm.jump_url || ''
        const m =
          jump.match(/live\.bilibili\.com\/(\d+)/) ||
          jump.match(/room_id=(\d+)/)
        if (m) {
          out[m[1]] = rm.title || rm.name || m[1]
        }
      }
    }
    return out
  } catch (e) {
    const errMsg = `TabPage(${page}) ${e.message}`
    tjLogger.debug(`CNY: ${errMsg}`)
    recordError(errMsg)
    return {}
  }
}

/**
 * 获取房间福气值 + 未领取阶段
 * @param {string} roomId 房间 ID
 * @returns {Promise<object|null>}
 */
async function fetchRoomFortune(roomId) {
  try {
    const resp = await fetch(`${TASK_API}${roomId}`, {
      headers: getHeaders(),
      timeout: 8000,
    })
    if (!resp.ok) {
      const errMsg = `Fortune(${roomId}) HTTP ${resp.status}`
      tjLogger.debug(`CNY: ${errMsg}`)
      recordError(errMsg)
      return null
    }
    const d = await resp.json()
    if (d.code !== 0) {
      // code!=0 不一定是错误 (可能房间无活动), 仅 -101 等 Cookie 失效算错误
      if (d.code === -101) recordError(`Fortune(${roomId}) Cookie失效`)
      return null
    }
    const td = d.data
    const current = parseInt(td.fortune_value)
    const title = td.title || ''
    const streamer = td.user?.name || ''

    const steps = []
    for (const step of td.steps || []) {
      if (step.state === 0) {
        const b = step.bonus
        steps.push({
          limit: parseInt(step.limit),
          bonusInfo: b,
          bonusName: b?.name || '?',
          bonusNum: b?.num || 0,
          bonusTime: b?.time || 0,
          isTimed: (b?.time || 0) !== 0,
        })
      }
    }
    if (steps.length === 0) return null
    return { roomId, title, streamer, current, steps }
  } catch (e) {
    const errMsg = `Fortune(${roomId}) ${e.message}`
    tjLogger.debug(`CNY: ${errMsg}`)
    recordError(errMsg)
    return null
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  推送
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 发送群消息
 * @param {number} groupId 群号
 * @param {string} msg 消息内容
 */
async function sendGroupMsg(groupId, msg) {
  try {
    // eslint-disable-next-line no-undef
    let tmpBot = Bot
    // eslint-disable-next-line no-undef
    if (Array.isArray(Bot)) {
      // eslint-disable-next-line no-undef
      tmpBot = Bot[config.getConfig().botQQ || 0]
    }
    await tmpBot.pickGroup(Number(groupId)).sendMsg(msg)
    tjLogger.debug(`CNY: 推送群消息到 ${groupId} 成功`)
  } catch (e) {
    tjLogger.error(`CNY: 推送群消息到 ${groupId} 失败: ${e.message}`)
  }
}

/**
 * 推送到所有配置群
 * @param {string} msg 消息内容
 */
async function pushToGroups(msg) {
  const groups = getPushGroups()
  for (const gid of groups) {
    await sendGroupMsg(gid, msg)
  }
}

/**
 * 构建福气值预警推送消息
 * @param {object} room 房间数据
 * @param {string} rid 房间 ID
 * @returns {string}
 */
function buildFortunePushMsg(room, rid) {
  const diff = room.target - room.current
  const estSec = room.estTime
  const estStr = isFinite(estSec)
    ? `约 ${Math.ceil(estSec / 60)} 分钟后`
    : '暂无法预估'

  return [
    '⚠️【新春奖品预警】',
    `📺 房间: ${room.name}`,
    `🎁 奖品: ${room.bonusName} (x${room.bonusNum})`,
    `📉 还差: ${diff.toLocaleString()} (${room.current.toLocaleString()}/${room.target.toLocaleString()})`,
    `⏰ 预估: ${estStr}`,
    `🔗 https://live.bilibili.com/${rid}`,
  ].join('\n')
}

/**
 * 构建定时奖品预警推送消息
 * @param {object} task 定时任务数据
 * @param {number} currentFortune 当前福气值
 * @param {number} timeLeft 距开抢秒数
 * @returns {string}
 */
function buildTimedPushMsg(task, currentFortune, timeLeft) {
  const timeStr = fmtTimestamp(task.bonusTime)
  const leftStr =
    timeLeft > 0 ? `还有${Math.ceil(timeLeft / 60)}分钟` : '即将开抢'
  const thresholdMet = currentFortune >= task.limit
  const statusStr = thresholdMet ? '✅已达标' : '❌未达标'

  return [
    '⏰【定时奖品预警】',
    `📺 房间: ${task.roomName}`,
    `🎁 奖品: ${task.bonusName} (x${task.bonusNum})`,
    `📅 开抢: ${timeStr} (${leftStr})`,
    `📊 门槛: ${task.limit.toLocaleString()} (当前: ${currentFortune.toLocaleString()}) ${statusStr}`,
    `🔗 https://live.bilibili.com/${task.roomId}`,
  ].join('\n')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  房间数据更新 + 推送判断
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 更新房间数据、注册定时任务、判断是否推送/加入高频
 * @param {object} rm 房间缓存数据
 * @param {object} res API 返回结果
 * @param {string} rid 房间 ID
 */
function updateRoom(rm, res, rid) {
  const cfg = getCfg()
  const steps = res.steps
  const fortuneStep = steps.find((s) => !s.isTimed) || null
  const targetStep = fortuneStep || steps[0]

  rm.current = res.current
  rm.target = targetStep.limit
  rm.bonusInfo = targetStep.bonusInfo
  rm.bonusName = targetStep.bonusName
  rm.bonusNum = targetStep.bonusNum
  rm.isFortuneTarget = fortuneStep !== null
  rm.allSteps = steps
  rm.history.push([Date.now() / 1000, res.current])
  // 保留最近 10 条历史
  if (rm.history.length > 10) rm.history.shift()
  rm.estTime = fortuneStep
    ? calcEstTime(rm.history, rm.current, rm.target)
    : Infinity

  // 注册定时任务
  for (const s of steps) {
    if (s.isTimed) {
      const tkey = String(s.bonusInfo?.sub_task_id)
      if (!cnyState.timedTasks[tkey]) {
        cnyState.timedTasks[tkey] = {
          roomId: rid,
          roomName: rm.name,
          bonusInfo: s.bonusInfo,
          bonusName: s.bonusName,
          bonusNum: s.bonusNum,
          bonusTime: s.bonusTime,
          limit: s.limit,
        }
        tjLogger.info(
          `CNY: 发现定时任务 ${rm.name} - ${s.bonusName} (开抢: ${fmtTimestamp(s.bonusTime)})`,
        )
      }
    }
  }

  // 福气值推送逻辑 (仅针对非定时目标)
  if (!rm.isFortuneTarget) return

  const diff = rm.target - rm.current
  const pct = (rm.current / Math.max(rm.target, 1)) * 100
  const subTaskId = targetStep.bonusInfo?.sub_task_id || rm.target
  const est = rm.estTime

  // 多阶段差值推送
  const diffStages = parseStageCfg(
    cfg.pushDiffStages,
    [40000, 30000, 20000, 10000, 5000],
  )
  for (const stage of diffStages) {
    if (diff > stage) continue
    const pushKey = `fortune:${rid}:${subTaskId}:diff${stage}`
    if (cnyState.pushedSet.has(pushKey)) continue
    cnyState.pushedSet.add(pushKey)
    const msg = buildFortunePushMsg(rm, rid)
    pushToGroups(msg)
    tjLogger.info(`CNY: 房间 ${rid}(${rm.name}) 达到差值阶段 ≤${stage}, 已推送`)
    break // 每轮只推一个新阶段
  }

  // 多阶段时间推送
  if (isFinite(est)) {
    const timeStages = parseStageCfg(
      cfg.pushTimeStages,
      [300, 180, 120, 60, 30],
    )
    for (const stage of timeStages) {
      if (est > stage) continue
      const pushKey = `fortune:${rid}:${subTaskId}:time${stage}`
      if (cnyState.pushedSet.has(pushKey)) continue
      cnyState.pushedSet.add(pushKey)
      const msg = buildFortunePushMsg(rm, rid)
      pushToGroups(msg)
      tjLogger.info(
        `CNY: 房间 ${rid}(${rm.name}) 达到时间阶段 ≤${stage}s, 已推送`,
      )
      break
    }
  }

  // 高频监控进入条件: 用最大阶段值作为门槛
  const hfDiff = cfg.hfDiffThreshold ?? 50000
  const hfPct = cfg.hfProgressPct ?? 80
  const scanInterval = cfg.scanInterval ?? 60

  const shouldHf =
    pct >= hfPct ||
    diff <= hfDiff ||
    (isFinite(est) && est <= scanInterval * 1.2)

  if (shouldHf) {
    cnyState.hfSet.add(rid)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  定时任务推送检查
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 检查定时任务是否满足推送条件
 */
function checkTimedTaskPush() {
  const cfgVal = getCfg()
  const diffStages = parseStageCfg(
    cfgVal.pushDiffStages,
    [40000, 30000, 20000, 10000, 5000],
  )
  const timeStages = parseStageCfg(
    cfgVal.pushTimeStages,
    [300, 180, 120, 60, 30],
  )
  const now = Date.now() / 1000

  for (const [tkey, task] of Object.entries(cnyState.timedTasks)) {
    const timeLeft = task.bonusTime - now
    // 跳过已过期的
    if (timeLeft < -60) continue

    const rm = cnyState.rooms[task.roomId]
    const currentFortune = rm?.current || 0
    const fortuneDiff = task.limit - currentFortune

    // 多阶段差值推送
    if (fortuneDiff >= 0) {
      for (const stage of diffStages) {
        if (fortuneDiff > stage) continue
        const pushKey = `timed:${tkey}:diff${stage}`
        if (cnyState.pushedSet.has(pushKey)) continue
        cnyState.pushedSet.add(pushKey)
        const msg = buildTimedPushMsg(task, currentFortune, timeLeft)
        pushToGroups(msg)
        tjLogger.info(
          `CNY: 定时 ${task.roomName} - ${task.bonusName} 达到差值阶段 ≤${stage}, 已推送`,
        )
        break
      }
    }

    // 多阶段时间推送
    if (timeLeft > 0) {
      for (const stage of timeStages) {
        if (timeLeft > stage) continue
        const pushKey = `timed:${tkey}:time${stage}`
        if (cnyState.pushedSet.has(pushKey)) continue
        cnyState.pushedSet.add(pushKey)
        const msg = buildTimedPushMsg(task, currentFortune, timeLeft)
        pushToGroups(msg)
        tjLogger.info(
          `CNY: 定时 ${task.roomName} - ${task.bonusName} 达到时间阶段 ≤${stage}s, 已推送`,
        )
        break
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  线程 1: 全站慢速扫描
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 执行一轮全站扫描
 */
async function slowScan() {
  if (!cnyState.running) return
  const cfgData = getCfg()
  cnyState.scanRound++
  cnyState.scanning = true

  tjLogger.debug(`CNY: 开始第 ${cnyState.scanRound} 轮全站扫描`)

  try {
    // 阶段 1: 逐页获取房间列表 (串行, 避免请求过快)
    const pages = cfgData.scanPages || 15
    const tabNames = {}
    for (let p = 1; p <= pages; p++) {
      if (!cnyState.running) break
      const pageResult = await fetchTabPage(p)
      Object.assign(tabNames, pageResult)
    }

    const roomIds = Object.keys(tabNames)
    const total = roomIds.length

    tjLogger.debug(`CNY: 扫描到 ${total} 个房间`)

    if (total === 0) {
      cnyState.scanning = false
      return
    }

    // 阶段 2: 并行查询福气值
    const alive = new Set()
    const fortuneResults = await parallelMap(
      roomIds,
      (rid) => fetchRoomFortune(rid),
      cfgData.parallelWorkers || 15,
    )

    for (let i = 0; i < roomIds.length; i++) {
      if (!cnyState.running) break
      const rid = roomIds[i]
      const result = fortuneResults[i]
      if (result.status !== 'fulfilled' || !result.value) continue

      const res = result.value
      alive.add(rid)

      if (!cnyState.rooms[rid]) {
        cnyState.rooms[rid] = {
          name: tabNames[rid] || res.streamer || res.title || rid,
          current: 0,
          target: 0,
          history: [],
          estTime: Infinity,
          bonusInfo: null,
          bonusName: '',
          bonusNum: 0,
          isFortuneTarget: true,
          allSteps: [],
        }
      }
      updateRoom(cnyState.rooms[rid], res, rid)
    }

    // 清理无效房间
    for (const rid of roomIds) {
      if (!alive.has(rid) && cnyState.rooms[rid]) {
        delete cnyState.rooms[rid]
        cnyState.hfSet.delete(rid)
      }
    }

    // 扫描完成后检查定时任务
    checkTimedTaskPush()
  } catch (e) {
    tjLogger.error(`CNY: 慢速扫描异常: ${e.message}`)
    recordError(`扫描异常: ${e.message}`)
  }

  cnyState.scanning = false
  tjLogger.debug(
    `CNY: 第 ${cnyState.scanRound} 轮扫描完成, 活跃: ${Object.keys(cnyState.rooms).length}, 高频: ${cnyState.hfSet.size}, 定时: ${Object.keys(cnyState.timedTasks).length}`,
  )
}

/**
 * 慢速扫描循环 (scan → wait → scan)
 */
async function slowScanLoop() {
  if (!cnyState.running) return
  await slowScan()
  if (!cnyState.running) return
  const interval = (getCfg().scanInterval || 60) * 1000
  cnyState._slowTimer = setTimeout(slowScanLoop, interval)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  线程 2: 高频监控
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 执行一轮高频监控
 */
async function hfMonitor() {
  if (!cnyState.running) return

  const toCheck = [...cnyState.hfSet]

  if (toCheck.length > 0) {
    tjLogger.debug(`CNY: 高频监控 ${toCheck.length} 个房间`)

    for (const rid of toCheck) {
      if (!cnyState.running) break
      const res = await fetchRoomFortune(rid)
      if (!res) {
        cnyState.hfSet.delete(rid)
        continue
      }
      if (!cnyState.rooms[rid]) continue
      updateRoom(cnyState.rooms[rid], res, rid)

      // 福气满了且是福气值任务, 移出监控
      const rm = cnyState.rooms[rid]
      if (rm.current >= rm.target && rm.isFortuneTarget) {
        cnyState.hfSet.delete(rid)
      }
    }
  }

  // 每次高频监控也检查定时任务
  checkTimedTaskPush()
}

/**
 * 高频监控循环
 */
async function hfMonitorLoop() {
  if (!cnyState.running) return
  await hfMonitor()
  if (!cnyState.running) return
  const interval = (getCfg().monitorInterval || 10) * 1000
  cnyState._hfTimer = setTimeout(hfMonitorLoop, interval)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  启停控制
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 启动 CNY 监控
 * @returns {boolean} 是否成功启动
 */
export function startCnyMonitor() {
  const cfg = getCfg()

  if (!cfg.enable) {
    tjLogger.info('CNY 监控未启用')
    return false
  }
  if (!cfg.cookie) {
    tjLogger.warn('CNY 监控: 未配置 B站 Cookie, 无法启动')
    return false
  }
  if (cnyState.running) {
    tjLogger.info('CNY 监控已在运行中')
    return false
  }

  const groups = getPushGroups()
  if (groups.length === 0) {
    tjLogger.warn('CNY 监控: 未配置推送群, 无法启动')
    return false
  }

  cnyState.running = true
  cnyState.startTime = Date.now()
  cnyState.reset()

  tjLogger.info(
    `CNY 监控启动: 扫描${cfg.scanPages || 15}页, 间隔${cfg.scanInterval || 60}s, 高频${cfg.monitorInterval || 10}s, 推送群: ${groups.join(',')}`,
  )

  // 启动两个循环
  slowScanLoop()
  // 高频监控延迟启动, 等第一轮扫描提供数据
  setTimeout(hfMonitorLoop, 15000)

  return true
}

/**
 * 停止 CNY 监控
 */
export function stopCnyMonitor() {
  cnyState.running = false
  if (cnyState._slowTimer) {
    clearTimeout(cnyState._slowTimer)
    cnyState._slowTimer = null
  }
  if (cnyState._hfTimer) {
    clearTimeout(cnyState._hfTimer)
    cnyState._hfTimer = null
  }
  tjLogger.info('CNY 监控已停止')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  查询接口 (供指令使用)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 获取房间详细信息 (从缓存)
 * @param {string} roomId 房间 ID
 * @returns {object|null}
 */
export function getRoomInfo(roomId) {
  return cnyState.rooms[roomId] || null
}

/**
 * 获取所有定时任务
 * @returns {Array<object>}
 */
export function getTimedTasks() {
  return Object.entries(cnyState.timedTasks).map(([tkey, task]) => ({
    subTaskId: tkey,
    ...task,
    currentFortune: cnyState.rooms[task.roomId]?.current || 0,
  }))
}

/**
 * 获取最近的奖品列表 (按紧迫度排序)
 * @param {number} limit 返回数量
 * @returns {Array<object>}
 */
export function getNearestPrizes(limit = 10) {
  const entries = []
  const now = Date.now() / 1000

  // 福气值类条目
  for (const [rid, rm] of Object.entries(cnyState.rooms)) {
    if (!rm.isFortuneTarget || rm.target <= 0) continue
    const diff = rm.target - rm.current
    if (diff <= 0) continue
    entries.push({
      type: 'fortune',
      roomId: rid,
      roomName: rm.name,
      bonusName: rm.bonusName,
      bonusNum: rm.bonusNum,
      current: rm.current,
      target: rm.target,
      diff,
      pct: ((rm.current / Math.max(rm.target, 1)) * 100).toFixed(1),
      estTime: rm.estTime,
      urgency: isFinite(rm.estTime) ? rm.estTime : Infinity,
    })
  }

  // 定时类条目
  for (const [, task] of Object.entries(cnyState.timedTasks)) {
    const timeLeft = task.bonusTime - now
    if (timeLeft < -60) continue
    const rm = cnyState.rooms[task.roomId]
    const currentFortune = rm?.current || 0
    entries.push({
      type: 'timed',
      roomId: task.roomId,
      roomName: task.roomName,
      bonusName: task.bonusName,
      bonusNum: task.bonusNum,
      current: currentFortune,
      target: task.limit,
      diff: task.limit - currentFortune,
      pct: ((currentFortune / Math.max(task.limit, 1)) * 100).toFixed(1),
      estTime: Math.max(0, timeLeft),
      urgency: Math.max(0, timeLeft),
      bonusTime: task.bonusTime,
    })
  }

  // 按紧迫度升序
  entries.sort((a, b) => a.urgency - b.urgency)
  return entries.slice(0, limit)
}

/**
 * 获取监控状态
 * @returns {object}
 */
export function getStatus() {
  const now = Date.now()
  const uptime = cnyState.running
    ? Math.floor((now - cnyState.startTime) / 1000)
    : 0
  // 清理过期错误 & 统计
  cnyState.errors = cnyState.errors.filter((e) => now - e.ts < ERROR_WINDOW_MS)
  const recentErrors = cnyState.errors
  const lastError =
    recentErrors.length > 0 ? recentErrors[recentErrors.length - 1] : null
  return {
    running: cnyState.running,
    scanRound: cnyState.scanRound,
    scanning: cnyState.scanning,
    roomCount: Object.keys(cnyState.rooms).length,
    hfCount: cnyState.hfSet.size,
    timedCount: Object.keys(cnyState.timedTasks).length,
    pushedCount: cnyState.pushedSet.size,
    uptime,
    errorCount5m: recentErrors.length,
    lastError: lastError
      ? {
          time: new Date(lastError.ts).toLocaleTimeString('zh-CN'),
          msg: lastError.msg,
        }
      : null,
  }
}

/**
 * 判断群号是否为推送群
 * @param {number} groupId 群号
 * @returns {boolean}
 */
export function isPushGroup(groupId) {
  return getPushGroups().includes(Number(groupId))
}
