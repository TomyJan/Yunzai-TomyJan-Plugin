import plugin from '../../../lib/plugins/plugin.js'
import config from '../components/config.js'
import tjLogger from '../components/logger.js'
import { inspectAiImage } from '../model/aiImage.js'
import { extractImageUrls } from '../model/aiImageMessage.js'

export class aiImageApp extends plugin {
  constructor() {
    super({
      name: '[TJ插件]AI图片识别',
      dsc: '检查图片是否包含 AI 来源或生成信号',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '^#?[aA][iI]图$',
          fnc: 'inspectImage',
        },
      ],
    })
  }

  async inspectImage() {
    if (!config.getConfig().aiImage?.enable) {
      await this.reply('AI 图片识别功能未启用', true)
      return
    }

    try {
      const imageUrls = await extractImageUrls(this.e)
      if (imageUrls.length === 0) {
        await this.reply('请发送或引用一张图片后再使用 ai图', true)
        return
      }
      const result = await inspectAiImage(imageUrls[0], config.getConfig())
      await this.reply(result.message, true)
    } catch (error) {
      tjLogger.error(`[AI图片识别] 检查失败: ${error.message}`)
      await this.reply(`AI 图片识别失败: ${error.message}`, true)
    }
  }
}
