import chalk from 'chalk'
import fs from 'fs'
import { _CfgPath, _DataPath } from '../data/system/pluginConstants.js'
import tjLogger from './logger.js'
import { migrateAiImageConfig } from '../model/aiImageConfig.js'

class ConfigReader {
  constructor() {
    this.filePath = _CfgPath + '/config.json'
    this.configObject = this.readConfig() // 初始读取配置文件
    this.watchConfig() // 监听配置文件变化
  }

  readConfig() {
    try {
      if (!fs.existsSync(this.filePath)) {
        const defaultConfigPath = _DataPath + '/system/default_config.json'
        fs.writeFileSync(
          this.filePath,
          fs.readFileSync(defaultConfigPath),
          'utf8',
        )
      }
      const data = fs.readFileSync(this.filePath, 'utf8')
      const parsedConfig = JSON.parse(data)
      const configObject = migrateAiImageConfig(parsedConfig)
      if (JSON.stringify(configObject) !== JSON.stringify(parsedConfig)) {
        fs.writeFileSync(this.filePath, JSON.stringify(configObject, null, 2))
        tjLogger.info('AI 图片配置已迁移到多凭据格式')
      }
      return configObject
    } catch (error) {
      // eslint-disable-next-line no-undef
      logger.error(
        chalk.red(`[TJ插件][WARN  ] 读取配置文件失败: ${error.message}`),
      )
      return {}
    }
  }

  watchConfig() {
    fs.watchFile(this.filePath, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        this.configObject = this.readConfig()
        tjLogger.info('配置文件已更新')
        tjLogger.setLogLevel(this.configObject.logger.logLevel)
      }
    })
  }

  getConfig() {
    return this.configObject
  }
}

export default new ConfigReader()
