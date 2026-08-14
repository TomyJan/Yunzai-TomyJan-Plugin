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
      // 图标颜色，例：#FF0000 或 rgb(255, 0, 0)
      iconColor: pluginThemeColor,
      // 如果想要显示成图片，也可以填写图标路径（绝对路径）
      iconPath: _ResPath + '/img/common/icon/tomyjan.png',
    },
    // 配置项信息
    configInfo: {
      // 配置项 schemas
      schemas: [
        {
          component: 'SOFT_GROUP_BEGIN',
          label: '日志设置',
        },
        {
          field: 'logger.logLevel',
          label: '日志等级',
          helpMessage: 'TJ 插件内置的日志记录器的日志等级, 与 Yunzai 的独立',
          bottomHelpMessage: '更改即时生效, 通常应选择 info',
          component: 'Select',
          componentProps: {
            options: [
              { label: 'debug', value: 'debug' },
              { label: 'info', value: 'info' },
              { label: 'warn', value: 'warn' },
              { label: 'error', value: 'error' },
            ],
            placeholder: '配置项异常',
          },
        },
        {
          field: 'logger.saveToFile',
          label: '保存日志',
          helpMessage: '独立保存 TJ 插件的日志到 插件根目录/data/logs/',
          bottomHelpMessage: '更改即时生效, 通常不建议启用',
          component: 'Switch',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: '代理设置',
        },
        {
          field: 'proxy.url',
          label: '代理服务器地址',
          helpMessage: '插件外部网络请求共用的 HTTP 或 HTTPS 代理地址',
          bottomHelpMessage: '例如 http://127.0.0.1:7890，各功能需单独开启代理',
          component: 'Input',
        },
        {
          field: 'proxy.autoUpdate',
          label: '自动更新检查使用代理',
          helpMessage: '自动检查更新时通过代理访问更新源',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: 'JMComic 功能设置',
        },
        {
          field: 'JMComic.enable',
          label: '启用',
          helpMessage: '是否启用 JMComic 功能',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          field: 'JMComic.proxy.enable',
          label: '下载使用代理',
          helpMessage: '下载前将全局代理地址同步到 JMComic 配置文件',
          bottomHelpMessage: '关闭时只移除由插件管理的 proxies 配置',
          component: 'Switch',
        },
        {
          field: 'JMComic.albumIdBlacklist.enable',
          label: '启用本子 ID 黑名单',
          helpMessage: '下载前检查规范化后的 JMComic 本子 ID',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          field: 'JMComic.albumIdBlacklist.ids',
          label: '本子 ID 黑名单',
          helpMessage: '逐项添加禁止下载的 JMComic 本子 ID',
          bottomHelpMessage: '数字与数字字符串等价，前导零会被忽略',
          component: 'GTags',
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
        {
          field: 'JMComic.authorNameBlacklist.enable',
          label: '启用作者名称黑名单',
          helpMessage: '启用后每次下载前会额外查询一次本子详情，会影响响应速度',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          field: 'JMComic.authorNameBlacklist.names',
          label: '作者名称黑名单',
          helpMessage: '逐项添加禁止下载的作者名称，英文不区分大小写',
          bottomHelpMessage: 'jmv 最多获取前 10 个作者，仅检查这些可见作者',
          component: 'GTags',
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
        {
          field: 'JMComic.pdfPassword',
          label: 'PDF 密码',
          helpMessage: '设置 JMComic 功能发送的 PDF 密码',
          bottomHelpMessage: '更改即时生效, 留空不设置密码',
          component: 'Input',
        },
        {
          field: 'JMComic.sendPdfPassword',
          label: '发送 PDF 密码',
          helpMessage:
            '发送 JMComic 功能发送的 PDF 时是否同时发送 PDF 密码, 如果同时开启下方归档 PDF 功能, 请请确保设置的密码没有不可用于文件名的字符',
          bottomHelpMessage: '更改即时生效, 默认不发送',
          component: 'Switch',
        },
        {
          field: 'JMComic.sendFilePolicy',
          label: '发送策略',
          helpMessage:
            '发送 JMComic 功能发送的 PDF 的策略, 只传文件 / 优先文件 / 只发链接',
          bottomHelpMessage:
            '更改即时生效, 若选择非 只传文件 请开启并配置好下方的 HTTP 服务器',
          component: 'Select',
          componentProps: {
            options: [
              { label: '只传文件', value: 1 },
              { label: '优先文件', value: 2 },
              { label: '只发链接', value: 3 },
            ],
            placeholder: '配置项异常',
          },
        },
        {
          field: 'JMComic.archiveDownloadedImg',
          label: '归档图片',
          helpMessage: '是否归档下载的图片, 若开启, 归档将同时将用作下载加速',
          bottomHelpMessage:
            '更改即时生效, 归档保存在 插件根目录/data/JMComic/archives/download/ 下',
          component: 'Switch',
        },
        {
          field: 'JMComic.archiveConvertedPdf',
          label: '归档 PDF',
          helpMessage:
            '是否归档转换的 PDF, 若为加密 PDF 则文件名会加上密码, 请确保设置的密码没有不可用于文件名的字符',
          bottomHelpMessage:
            '更改即时生效, 归档保存在 插件根目录/data/JMComic/archives/convert/ 下',
          component: 'Switch',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: 'VV 说设置',
        },
        {
          field: 'vvShuo.enable',
          label: '启用',
          helpMessage: '是否启用 VV 说 功能',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          field: 'vvShuo.proxy.enable',
          label: '使用代理',
          helpMessage: 'VV 说 API 请求是否使用全局代理地址',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: 'AI 图片识别设置',
        },
        {
          field: 'aiImage.enable',
          label: '启用',
          helpMessage: '是否启用 AI 图片来源检测',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          field: 'aiImage.proxy.enable',
          label: '使用代理',
          helpMessage: '图片下载和所有外部检测渠道使用全局代理地址',
          bottomHelpMessage: '本地 C2PA 检测不使用代理',
          component: 'Switch',
        },
        {
          field: 'aiImage.timeoutMs',
          label: '请求超时毫秒数',
          helpMessage: '图片下载和单个检测渠道的最大请求时间',
          bottomHelpMessage: '更改即时生效, 默认 15000',
          component: 'InputNumber',
        },
        {
          field: 'aiImage.maxFileSize',
          label: '图片大小上限',
          helpMessage: '允许检测的最大字节数',
          bottomHelpMessage: '更改即时生效, 默认 52428800 (50 MiB)',
          component: 'InputNumber',
        },
        {
          field: 'aiImage.c2pa.enable',
          label: 'C2PA 检测',
          helpMessage: '在本地验证 C2PA Content Credentials',
          bottomHelpMessage: '无需 API key',
          component: 'Switch',
        },
        {
          field: 'aiImage.openai.enable',
          label: 'OpenAI 来源检测',
          helpMessage: '检测 OpenAI 支持的 C2PA 与 SynthID 信号',
          bottomHelpMessage: '需要 OpenAI API key',
          component: 'Switch',
        },
        {
          field: 'aiImage.openai.apiKeys',
          label: 'OpenAI API keys',
          helpMessage: '逐项添加 OpenAI API key',
          bottomHelpMessage: '401/403/404/429 时自动尝试下一个 key',
          component: 'GTags',
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
        {
          field: 'aiImage.hive.enable',
          label: 'Hive AI 检测',
          helpMessage: '使用 Hive V3 AI Image + Deepfake Classifier',
          bottomHelpMessage: '需要 Hive V3 Secret Key',
          component: 'Switch',
        },
        {
          field: 'aiImage.hive.apiKeys',
          label: 'Hive V3 Secret Keys',
          helpMessage: '只填写创建 V3 API Key 时显示的 Secret Key',
          bottomHelpMessage: '401/403/429 时自动尝试下一个 Secret Key',
          component: 'GTags',
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
        {
          field: 'aiImage.sightengine.enable',
          label: 'Sightengine 备用检测',
          helpMessage: '使用 Sightengine genai 模型作为可选第二意见',
          bottomHelpMessage: '默认关闭',
          component: 'Switch',
        },
        {
          field: 'aiImage.sightengine.credentials',
          label: 'Sightengine 凭据',
          helpMessage:
            '逐项添加 JSON 对象，例如 {"apiUser":"user","apiSecret":"secret"}',
          bottomHelpMessage: '401/403/429 时自动尝试下一组凭据',
          component: 'GTags',
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: 'EDU 认证设置',
        },
        {
          field: 'eduAuth.enable',
          label: '启用',
          helpMessage: '是否启用 EDU 认证 功能',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          field: 'eduAuth.proxy.enable',
          label: '使用代理',
          helpMessage: 'EDU 认证 API 请求是否使用全局代理地址',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          field: 'eduAuth.apiBaseUrl',
          label: 'API基础链接',
          helpMessage: '第三方 API 的基础链接',
          bottomHelpMessage: '更改即时生效',
          component: 'Input',
        },
        {
          field: 'eduAuth.apiKey',
          label: 'API密钥',
          helpMessage: '第三方 API 密钥，联系管理员获取',
          bottomHelpMessage: '更改即时生效',
          component: 'InputPassword',
        },
        {
          field: 'eduAuth.userGroup',
          label: '用户群群号',
          helpMessage: '用于监听加群申请和群成员上报',
          bottomHelpMessage: '更改即时生效',
          component: 'InputNumber',
        },
        {
          field: 'eduAuth.adminGroup',
          label: '管理群群号',
          helpMessage: '用于接收管理通知（如加群申请提醒）',
          bottomHelpMessage: '更改即时生效',
          component: 'InputNumber',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: 'HTTP 服务器设置',
        },
        {
          field: 'httpServer.enable',
          label: '启用',
          helpMessage:
            '请确保配置正确再开启, 插件只会依照此值决定是否使用内置服务器, 不会做更多判断',
          bottomHelpMessage: '更改重启生效, 插件内置 HTTP 服务器, 默认关闭',
          component: 'Switch',
        },
        {
          field: 'httpServer.listenPort',
          label: '监听端口',
          helpMessage: '插件内置 HTTP 服务器监听端口',
          bottomHelpMessage: '更改重启生效, 默认 5252',
          component: 'Input',
        },
        {
          field: 'httpServer.accessUrl',
          label: '访问 URL',
          helpMessage: '插件内置 HTTP 服务器供外部访问的访问 URL',
          bottomHelpMessage: '更改重启生效, 默认 http://127.0.0.1:5252/',
          component: 'Input',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: '随机背景图设置',
        },
        {
          field: 'useRandomBgInCard',
          label: '随机背景图',
          helpMessage:
            '卡片是否使用随机背景图, 获取失败会回退到最后一张图或者本地背景图, 本地默认背景图: 插件根目录/resources/img/common/bg/Alisa-Echo_0.jpg',
          bottomHelpMessage:
            '更改即时生效, 背景图 API: https://api.tomys.top/api/pnsWallPaper 均为战双官方壁纸',
          component: 'Switch',
        },
        {
          field: 'proxy.randomBackground',
          label: '随机背景图使用代理',
          helpMessage: '获取随机背景图时是否使用全局代理地址',
          bottomHelpMessage: '更改即时生效',
          component: 'Switch',
        },
        {
          component: 'SOFT_GROUP_BEGIN',
          label: '其他设置',
        },
        {
          field: 'attemptSendNonFriend',
          label: '发送非好友',
          helpMessage: '自动任务推送等场景用到',
          bottomHelpMessage: '更改即时生效, 是否尝试向非好友发送消息',
          component: 'Switch',
        },
        {
          field: 'botQQ',
          label: '机器人QQ',
          helpMessage: '留空则为自动获取',
          bottomHelpMessage: '更改即时生效, 使用某些第三方适配器可能需要设置',
          component: 'Input',
        },
      ],
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
        let saveRst = updateConfigFile()
        if (saveRst) return Result.error(saveRst)
        else return Result.ok({}, '保存成功辣ε(*´･ω･)з')
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
      let testConfigJson = mergeObjects(defaultConfigJson, configJson)
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
      let errMsg = '更新配置文件失败: ' + error.message
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
    let mergedObj = { ...oldObj }

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
