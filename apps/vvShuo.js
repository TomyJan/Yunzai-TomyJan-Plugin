import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import { withProxy } from '../model/proxy.js'
import {
  VV_SHUO_COMMAND_PATTERN,
  buildVvShuoSearchUrl,
  normalizeVvShuoResponse,
  parseVvShuoRequest,
} from '../model/vvShuo.js'

export class vvShuoApp extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: '[TJ插件]VV说',
      /** 功能描述 */
      dsc: 'VV说',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 1000,
      rule: [
        {
          reg: VV_SHUO_COMMAND_PATTERN,
          fnc: 'vvShuoSearch',
        },
      ],
    })
  }

  async vvShuoSearch() {
    const pluginConfig = config.getConfig()

    // 一些预检
    if (!pluginConfig.vvShuo.enable) {
      await this.reply('VV 说 功能未启用', true)
      return
    }

    const request = parseVvShuoRequest(this.e.msg)
    const content = request?.content || ''
    const isEnhanced = request?.enhanced || false
    if (!content) {
      await this.reply('VV 要说什么?', true)
      return
    }

    const contentNum = 2
    const searchApiUrl = buildVvShuoSearchUrl({
      content,
      enhanced: isEnhanced,
      count: contentNum,
    })
    tjLogger.debug(
      `VV 说${
        isEnhanced ? '增强版' : ''
      }准备搜索: ${content}, 搜索地址: ${searchApiUrl}`,
    )

    return fetch(
      searchApiUrl,
      withProxy({}, pluginConfig, pluginConfig.vvShuo.proxy?.enable, {
        feature: 'VV 说',
        warn: (message) => tjLogger.warn(message),
      }),
    )
      .then((response) => {
        if (!response.ok) {
          tjLogger.error(
            `VV说${isEnhanced ? '增强版' : ''}API请求失败: ${response.status} ${
              response.statusText
            }`,
          )
          throw new Error(
            `VV ${isEnhanced ? '增强版 ' : ''}说不出话: ${response.status} ${
              response.statusText
            }`,
          )
        }
        return response.json()
      })
      .then((jsonData) => {
        tjLogger.debug(
          `VV说${isEnhanced ? '增强版' : ''}API返回数据: ${JSON.stringify(
            jsonData,
          )}`,
        )

        const imageUrls = normalizeVvShuoResponse(jsonData, {
          enhanced: isEnhanced,
        })

        // 发送所有图片
        return Promise.all(
          // eslint-disable-next-line no-undef
          imageUrls.map((imgUrl) => this.reply(segment.image(imgUrl))),
        )
      })
      .catch((error) => {
        tjLogger.error(
          `VV说${isEnhanced ? '增强版' : ''}搜索出错: ${error.message}`,
        )
        return this.reply(`${error.message}`, true)
      })
  }
}
