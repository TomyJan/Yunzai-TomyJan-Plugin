import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import fetch from 'node-fetch'
import { segment } from 'icqq'

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
          reg: '^#?(vv|VV|zvv|ZVV|(张?维为))说?(.*)$',
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

    let content = this.e.msg
      .replace(/#|zvv|ZVV|vv|VV|张维为|维为|说|：|:/g, '')
      .trim()
    if (!content) {
      await this.reply('VV 要说什么?', true)
      return
    }

    const contentNum = 2
    const searchApiUrl = `https://api.zvv.quest/search?q=${content}&n=${contentNum}`
    tjLogger.debug(`VV 说准备搜索: ${content}, 搜索地址: ${searchApiUrl}`)

    fetch(searchApiUrl)
      .then((response) => {
        if (!response.ok) {
          tjLogger.error(
            `VV说API请求失败: ${response.status} ${response.statusText}`
          )
          throw new Error(
            `VV 说不出话: ${response.status} ${response.statusText}`
          )
        }
        return response.json()
      })
      .then((jsonData) => {
        tjLogger.debug(`VV说API返回数据: ${JSON.stringify(jsonData)}`)

        if (jsonData.code !== 200) {
          tjLogger.error(`VV说API返回错误: ${jsonData}`)
          throw new Error(`VV 说有问题: ${jsonData.msg || '但没说啥问题'}`)
        }

        if (!Array.isArray(jsonData.data) || jsonData.data.length === 0) {
          tjLogger.error(`VV说API返回的数据格式不正确或为空: ${jsonData}`)
          throw new Error('VV 好像没说过这个')
        }

        // 发送所有图片
        return Promise.all(
          jsonData.data.map((imgUrl) => this.reply(segment.image(imgUrl)))
        )
      })
      .catch((error) => {
        tjLogger.error(`VV说搜索出错: ${error.message}`)
        return this.reply(`${error.message}`, true)
      })
  }
}
