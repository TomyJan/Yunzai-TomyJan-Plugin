import path from 'path'
import fs from 'fs'
import {
  pluginName,
  pluginNameReadable,
  pluginAuthor,
  pluginRepo,
  pluginDesc,
  pluginThemeColor,
  _ResPath,
  _CfgPath,
  _DataPath,
} from './data/system/pluginConstants.js'
import tjLogger from './components/logger.js'
import { sendMsgFriend } from './model/utils.js'
import cfg from '../../lib/config/config.js'
import {
  migrateAiImageConfig,
  parseApiKeys,
  parseSightengineCredentials,
  serializeAiImageCredentialFields,
} from './model/aiImageConfig.js'
import { getGuobaSchemas } from './model/guobaSchemas.js'

// 支持锅巴
export function supportGuoba() {
  const configPath = path.join(_CfgPath, 'config.json')
  const defaultConfigPath = path.join(_DataPath, 'system/default_config.json')

  let configJson
  getConfigFromFile()
  return {
    // 插件信息，将会显示在前端页面
    // 如果你的插件没有在插件库里，那么需要填上补充信息
    // 如果存在的话，那么填不填就无所谓了，填了就以你的信息为准
    pluginInfo: {
      name: pluginName,
      title: pluginNameReadable,
      author: pluginAuthor,
      authorLink: pluginRepo,
      link: pluginRepo,
      isV3: true,
      isV2: false,
      description: pluginDesc,
      // 显示图标，此为个性化配置
      // 图标可在 https://icon-sets.iconify.design 这里进行搜索
      icon: 'arcticons:i-love-hue-too',
      iconColor: pluginThemeColor,
      // 如果想要显示成图片，也可以填写图标路径（绝对路径）
      iconPath: _ResPath + '/img/common/icon/tomyjan.png',
    },
    configInfo: {
      schemas: getGuobaSchemas(),
      // 获取配置数据方法（用于前端填充显示数据）
      getConfigData() {
        return serializeAiImageCredentialFields(configJson)
      },
      // 设置配置的方法（前端点确定后调用的方法）
      setConfigData(data, { Result }) {
        try {
          configJson = migrateAiImageConfig(
            normalizeConfigValues(flattenObject(data)),
          )
        } catch (error) {
          return Result.error(error.message)
        }
        tjLogger.debug('准备保存新配置')
        const saveRst = updateConfigFile()
        if (saveRst) return Result.error(saveRst)
        return Result.ok({}, '保存成功辣ε(*´･ω･)з')
      },
    },
  }

  function normalizeConfigValues(value) {
    if (!value.aiImage) return value

    value.aiImage.openai.apiKeys = parseApiKeys(
      value.aiImage.openai.apiKeys,
      'OpenAI API keys',
    )
    value.aiImage.hive.apiKeys = parseApiKeys(
      value.aiImage.hive.apiKeys,
      'Hive V3 Secret Keys',
    )
    value.aiImage.sightengine.credentials = parseSightengineCredentials(
      value.aiImage.sightengine.credentials,
    )
    return value
  }

  function getConfigFromFile() {
    try {
      // 尝试读取config.json
      const rawData = fs.readFileSync(configPath)
      configJson = migrateAiImageConfig(JSON.parse(rawData))

      // 读取 default_config.json
      const defaultRawData = fs.readFileSync(defaultConfigPath)
      const defaultConfigJson = JSON.parse(defaultRawData)

      // 比较配置文件更新
      const testConfigJson = mergeObjects(defaultConfigJson, configJson)
      if (JSON.stringify(testConfigJson) !== JSON.stringify(configJson)) {
        tjLogger.warn('配置文件有更新, 建议检查是否有新的项目需要配置!')
        configJson = testConfigJson
        updateConfigFile()
        sendMsgFriend(
          cfg.masterQQ[0],
          `[TJ插件] 配置文件有更新, 建议检查是否有新的项目需要配置!`,
        )
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 如果config.json不存在，则从default_config.json复制一份
        tjLogger.warn('config.json 不存在, 生成默认配置...')
        const defaultRawData = fs.readFileSync(defaultConfigPath)
        fs.writeFileSync(configPath, defaultRawData)
        configJson = migrateAiImageConfig(JSON.parse(defaultRawData))
      } else {
        // 处理其他可能的读取错误
        tjLogger.error('读取 config.json 出错:', error.message)
      }
    }
  }

  /**
   * 更新配置文件
   * @returns {string | null} 返回错误信息，如果成功则返回null
   */
  function updateConfigFile() {
    try {
      fs.writeFileSync(configPath, JSON.stringify(configJson, null, 2))
      tjLogger.info('更新配置文件成功')
      return null
    } catch (error) {
      const errMsg = '更新配置文件失败: ' + error.message
      tjLogger.error('更新配置文件失败:', errMsg)
      return errMsg
    }
  }

  /**
   * 展开 json
   * @param {Object} inputJson 输入的 json
   * @returns {Object} 展开后的 json
   */
  function flattenObject(inputJson) {
    const outputJson = {}

    for (const key in inputJson) {
      const keys = key.split('.')
      let currentObject = outputJson

      for (let i = 0; i < keys.length; i++) {
        const currentKey = keys[i]

        if (i === keys.length - 1) {
          // 最后一个键，赋予值
          currentObject[currentKey] = inputJson[key]
        } else {
          // 还不是最后一个键，继续进入下一层对象
          if (!currentObject[currentKey]) {
            // 如果下一个值是数组（通过看key是否为数字判断），则初始化为数组，否则为对象
            const nextKey = keys[i + 1]
            const isNextKeyNumeric =
              !isNaN(parseInt(nextKey, 10)) &&
              nextKey.toString() === parseInt(nextKey, 10).toString()
            currentObject[currentKey] = isNextKeyNumeric ? [] : {}
          }
          currentObject = currentObject[currentKey]
        }
      }
    }

    return outputJson
  }

  /**
   * 使用 newObj 补充 oldObj 缺失的字段
   * @param {Object} newObj 新对象
   * @param {Object} oldObj 旧对象
   * @returns {Object} 合并后的对象
   */
  function mergeObjects(newObj, oldObj) {
    const mergedObj = { ...oldObj }

    // 如果是数组，直接返回旧数组或新数组
    if (Array.isArray(newObj)) {
      return Array.isArray(oldObj) ? oldObj : newObj
    }

    for (const key in newObj) {
      // 处理数组的情况
      if (Array.isArray(newObj[key])) {
        // 如果旧对象中不存在该键或者旧对象中该键不是数组，则使用新对象中的数组
        if (!(key in mergedObj) || !Array.isArray(mergedObj[key])) {
          mergedObj[key] = [...newObj[key]]
        }
        // 如果都是数组，保留旧数组
      }
      // 处理对象的情况
      else if (typeof newObj[key] === 'object' && newObj[key] !== null) {
        if (!(key in mergedObj)) {
          mergedObj[key] = {}
        }
        // 递归合并子对象
        mergedObj[key] = mergeObjects(newObj[key], mergedObj[key])
      }
      // 处理基本类型
      else if (!(key in mergedObj)) {
        mergedObj[key] = newObj[key]
      }
    }
    return mergedObj
  }
}
