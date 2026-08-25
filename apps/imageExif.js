import plugin from '../../../lib/plugins/plugin.js'
import config from '../components/config.js'
import tjLogger from '../components/logger.js'
import { createReverseGeocoder } from '../model/imageExifLocation.js'
import { processImageExifEvent } from '../model/imageExifMessage.js'

const exifLogger = {
  debug: (message) => tjLogger.debug(`[图片EXIF] ${message}`),
  info: (message) => tjLogger.info(`[图片EXIF] ${message}`),
  warn: (message) => tjLogger.warn(`[图片EXIF] ${message}`),
  error: (message) => tjLogger.error(`[图片EXIF] ${message}`),
}
const reverseGeocode = createReverseGeocoder({ logger: exifLogger })

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
      logger: exifLogger,
    })
    if (result.status !== 'reply') return false
    await this.reply(result.message, true)
    return true
  }
}
