import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import { submitApiRequest } from '../model/eduAuth.js'
import { sleepAsync } from '../model/utils.js'

export class eduAuthApp extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: '[TJ插件]EDU认证',
      /** 功能描述 */
      dsc: 'EDU认证',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 1000,
      rule: [
        {
          reg: '^#?(edu|EDU)(认证|登录|登陆)?：?:? ?(.*)$',
          fnc: 'eduAuthSubmit',
        },
      ],
    })
  }

  async eduAuthSubmit() {
    // 一些预检
    if (!config.getConfig().eduAuth.enable) {
      await this.reply('EDU 认证 功能未启用', true)
      return
    }

    const whitelist = config.getConfig().eduAuth.whitelist
    if (this.e.group) {
      if (!whitelist.group.includes(this.e.group_id)) {
        await this.reply('EDU 认证 功能未在本群启用', true)
        return
      }
    }
    if (this.e.private) {
      if (!whitelist.private.includes(this.e.user_id)) {
        await this.reply('EDU 认证 功能未对您的私聊启用', true)
        return
      }
    }

    let content = this.e.msg
      .replace(/#|EDU|edu|认证|登录|登陆| |：|:/g, '')
      .trim()
    if (!content) {
      await this.reply('你的 IP 呢?', true)
      return
    }
    const ipRegex =
      /\b100\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/
    if (!ipRegex.test(content)) {
      await this.reply('你要不看看你发的 IP 对不对呢?', true)
      return
    }

    // 先取 acList, 然后从返回对象的 data 数组中取出对应 ipPrefix 的 ac，然后取出 ac 的 acIndex， acIndex 是 ac 的 index, 从 0 开始

    const acList = await submitApiRequest('aclist')
    if (!acList.success) {
      await this.reply(`EDU 认证 获取 AC 列表失败: ${acList.message}`, true)
      return
    }

    // 确保数据结构正确
    if (!acList.data || !acList.data.data || !Array.isArray(acList.data.data)) {
      await this.reply(
        `EDU 认证 获取 AC 列表返回数据异常: \n${JSON.stringify(acList.data)}`,
        true,
      )
      return
    }

    const acIndex = acList.data.data.findIndex((ac) =>
      content.startsWith(ac.ipPrefix),
    )
    if (acIndex === -1) {
      await this.reply(
        'EDU 认证 找不到对应 IP 段的 acName, 请检查 IP 是否正确',
        true,
      )
      return
    }

    // 提交认证请求
    const submitResult = await submitApiRequest('submit', {
      ip: content,
      acIndex,
    })
    if (!submitResult.success) {
      await this.reply(
        `EDU 认证 提交认证请求失败: ${submitResult.message}`,
        true,
      )
      return
    }

    // 确保数据结构正确
    if (!submitResult.data) {
      await this.reply(
        `EDU 认证 提交认证请求返回数据异常: \n${JSON.stringify(
          submitResult.data,
        )}`,
        true,
      )
      return
    }

    this.e.reply('任务提交成功，等待认证...', true)

    // 开始循环查询认证结果, 1s 查询一次, 直到 data.stopQuery 为 true, 或者连续 10 次请求出错, 或者到 300 次
    const maxQueryTimes = 300
    const maxErrorTimes = 10
    const queryInterval = 1000
    let queryTimes = 0
    let errorTimes = 0
    do {
      if (queryTimes >= maxQueryTimes) {
        await this.reply('EDU 认证 查询认证结果超时', true)
        return
      }
      if (errorTimes >= maxErrorTimes) {
        await this.reply(
          'EDU 认证 连续查询认证结果失败次数过多, 可能是网络问题或服务端问题',
          true,
        )
        return
      }
      queryTimes++
      const queryResult = await submitApiRequest('query', {
        ip: content,
      })
      if (!queryResult.success) {
        tjLogger.warn(
          `EDU 认证 第 ${queryTimes} 次查询认证结果失败: ${queryResult.message}`,
        )
        errorTimes++
        continue
      }

      tjLogger.debug(
        `EDU 认证 第 ${queryTimes} 次查询认证结果成功: ${JSON.stringify(
          queryResult.data,
        )}`,
      )

      // 确保数据结构正确
      if (!queryResult.data || !queryResult.data.data) {
        tjLogger.warn(
          `EDU 认证 第 ${queryTimes} 次查询认证结果数据结构异常: ${JSON.stringify(
            queryResult.data,
          )}`,
        )
        errorTimes++
        continue
      }

      if (queryResult.data.data.stopQuery) {
        // 然后把 queryResult.data.data.msg 本来是网页用的 p 标签，格式化成多行
        const msg = queryResult.data.msg
          .replace(/<p>/g, '')
          .replace(/<\/p>/g, '\n')
          .trim()
        tjLogger.info(
          `EDU 认证 第 ${queryTimes} 次查询认证结果成功且停止认证: ${msg}`,
        )
        await this.reply(msg, true)
        return
      }
      await sleepAsync(queryInterval)
    } while (queryInterval > 0) // 设置个始终 true 的
  }
}
