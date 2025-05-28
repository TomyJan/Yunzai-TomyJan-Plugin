import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import fetch from 'node-fetch'

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
          reg: '^#?(vv|VV|zvv|ZVV|(张?维为))(ol|OL|在线|增强)?说?(.*)$',
          fnc: 'vvShuoSearch',
        },
      ],
    })
  }

  async vvShuoSearch() {
    // 一些预检
    if (!config.getConfig().vvShuo.enable) {
      await this.reply('VV 说 功能未启用', true)
      return
    }

    const isEnhancedReg = /(ol|OL|在线|增强)/
    const isEnhanced = isEnhancedReg.test(this.e.msg)

    let content = this.e.msg
      .replace(/#|zvv|ZVV|vv|VV|张维为|维为|ol|OL|在线|增强|说|：|:/g, '')
      .trim()
    if (!content) {
      await this.reply('VV 要说什么?', true)
      return
    }

    const contentNum = 2
    const searchApiUrl = `https://api.zvv.quest/${
      isEnhanced ? 'enhanced' : ''
    }search?q=${content}&n=${contentNum}`
    tjLogger.debug(
      `VV 说${
        isEnhanced ? '增强版' : ''
      }准备搜索: ${content}, 搜索地址: ${searchApiUrl}`,
    )

    fetch(searchApiUrl)
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

        if (jsonData.code !== 200) {
          tjLogger.error(
            `VV说${isEnhanced ? '增强版' : ''}API返回错误: ${jsonData}`,
          )
          throw new Error(
            `VV 说${isEnhanced ? '增强版' : ''}有问题: ${
              jsonData.msg || '但没说啥问题'
            }`,
          )
        }

        if (!Array.isArray(jsonData.data) || jsonData.data.length === 0) {
          tjLogger.error(
            `VV说${
              isEnhanced ? '增强版' : ''
            }API返回的数据格式不正确或为空: ${jsonData}`,
          )
          throw new Error('VV 好像没说过这个')
        }

        // 发送所有图片
        return Promise.all(
          // eslint-disable-next-line no-undef
          jsonData.data.map((imgUrl) => this.reply(segment.image(imgUrl))),
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
