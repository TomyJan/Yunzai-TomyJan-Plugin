import plugin from '../../../lib/plugins/plugin.js'
import config from '../components/config.js'
import tjLogger from '../components/logger.js'
import { createReverseGeocoder } from '../model/imageExifLocation.js'
import { processImageExifEvent } from '../model/imageExifMessage.js'

const reverseGeocode = createReverseGeocoder({
  warn: (message) => tjLogger.warn(`[图片EXIF] ${message}`),
})

export class imageExifApp extends plugin {
  constructor() {
    super({
      name: '[TJ插件]图片EXIF定位',
      dsc: '自动提取图片 EXIF 定位并回复位置',
      event: 'message',
      priority: 9999,
      rule: [
        {
          reg: '.*',
          fnc: 'handleImage',
        },
      ],
    })
  }

  async handleImage() {
    const result = await processImageExifEvent(this.e, config.getConfig(), {
      reverseGeocode,
    })
    if (result.status === 'error') {
      tjLogger.warn(`[图片EXIF] ${result.stage} 阶段处理失败`)
      return false
    }
    if (result.status !== 'reply') return false
    await this.reply(result.message, true)
    return true
  }
}
