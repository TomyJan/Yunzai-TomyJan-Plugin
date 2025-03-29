import fs from 'node:fs'
import schedule from 'node-schedule'
import tjLogger from '../components/logger.js'
import {
  pluginVer,
  _DataPath,
  pluginThemeColor,
} from '../data/system/pluginConstants.js'
import { sendMsgFriend } from './utils.js'
import cfg from '../../../lib/config/config.js'
// import config from '../components/config.js'

export async function initAutoTask() {
  // TODO: 加回来定时任务相关配置
  // if (!config.getConfig()?.autoTask?.enabled) {
  //   tjLogger.info(pluginThemeColor(`自动任务已被禁用, 取消载入定时任务`))
  //   return false
  // }

  tjLogger.info(pluginThemeColor(`载入定时任务 checkUpdateTask`))
  schedule.scheduleJob('0 0 6/12 * * ? ', function () {
    checkUpdateTask()
  })
}

export async function checkUpdateTask() {
  tjLogger.info(`检查更新任务开始...`)
  let remoteVersion = await getRemoteVersion('GitHub')
  if (!remoteVersion) {
    remoteVersion = await getRemoteVersion('GHProxy')
    if (!remoteVersion) {
      remoteVersion = await getRemoteVersion('TomyJan')
      if (!remoteVersion) {
        tjLogger.warn(`检查更新任务失败`)
        await sendMsgFriend(cfg.masterQQ[0], `[TJ插件] 自动检查更新失败!`)
        return false
      }
    }
  }
  remoteVersion = remoteVersion.match(/\[(.*?)\]\(.*?\)/)[1] || false

  if (!remoteVersion) {
    tjLogger.info(`检查更新任务: 解析版本信息失败`)
    await sendMsgFriend(
      cfg.masterQQ[0],
      `[TJ插件] 自动检查更新\n解析版本信息失败\n请检查网络或前往项目地址检查版本信息\nhttps://github.com/TomyJan/Yunzai-TomyJan-Plugin`
    )
    return false
  }

  tjLogger.info(
    `检查更新任务: 获取到最新版本 ${remoteVersion}, 本地版本 ${pluginVer}`
  )
  if (remoteVersion != pluginVer) {
    // 推送并缓存
    const cacheFilePath = _DataPath + '/system/versionCache.json'
    let versionCache = ''

    try {
      versionCache = fs.readFileSync(cacheFilePath, 'utf8')
      tjLogger.debug(
        '读取 versionCache:',
        versionCache,
        ', 解析到缓存的版本:',
        JSON.parse(versionCache)?.remoteVersion
      )
    } catch (err) {
      tjLogger.error('读取 versionCache.json 时出现错误:', err.message)
    }

    if (JSON.parse(versionCache)?.remoteVersion == remoteVersion) {
      tjLogger.warn('该新版本已经推送过, 不再重复推送, 请及时更新!')
      return false
    }
    versionCache = JSON.stringify({ remoteVersion: remoteVersion })
    let isCacheSucceed = false

    try {
      fs.writeFileSync(cacheFilePath, versionCache)
      tjLogger.debug('缓存远程版本成功!')
      isCacheSucceed = true
    } catch (err) {
      tjLogger.error('写入versionCache.json 时出现错误:', err.message)
    }

    await sendMsgFriend(
      cfg.masterQQ[0],
      `[TJ插件] 自动检查更新\n发现新版: ${remoteVersion}\n本地版本: ${pluginVer}\n更新日志: https://github.com/TomyJan/Yunzai-TomyJan-Plugin/blob/master/CHANGELOG.md\n建议尽快更新~` +
        (isCacheSucceed ? '' : '\n缓存新版本信息失败, 该信息可能会重复推送')
    )
  }

  async function getRemoteVersion(type) {
    tjLogger.debug(`尝试从 ${type} 检查更新...`)
    let checkUrl =
      'https://raw.githubusercontent.com/TomyJan/Yunzai-TomyJan-Plugin/master/CHANGELOG.md'
    if (type == 'GHProxy') checkUrl = 'https://ghfast.top/' + checkUrl
    if (type == 'TomyJan')
      checkUrl =
        'https://proxy.vov.moe/https/raw.githubusercontent.com/TomyJan/Yunzai-TomyJan-Plugin/master/CHANGELOG.md'
    try {
      let rsp = await fetch(checkUrl)
      if (!rsp.ok) {
        tjLogger.warn(
          `从 ${type} 获取更新信息失败: ${rsp.status} ${rsp.statusText}`
        )
        return false
      }
      tjLogger.info(`从 ${type} 获取更新信息成功, 尝试解析信息...`)
      return await rsp.text()
    } catch (error) {
      tjLogger.warn(`从 ${type} 获取更新信息失败: ${error.message}`)
      return false
    }
  }
}
