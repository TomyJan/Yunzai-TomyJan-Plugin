function group(label) {
  return { component: 'SOFT_GROUP_BEGIN', label }
}

function tags(field, label, helpMessage, bottomHelpMessage) {
  return {
    field,
    label,
    helpMessage,
    bottomHelpMessage,
    component: 'GTags',
    componentProps: { allowAdd: true, allowDel: true },
  }
}

const schemas = [
  group('日志设置'),
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

  group('代理设置'),
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

  group('JMComic 功能设置'),
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
  tags(
    'JMComic.albumIdBlacklist.ids',
    '本子 ID 黑名单',
    '逐项添加禁止下载的 JMComic 本子 ID',
    '数字与数字字符串等价，前导零会被忽略',
  ),
  {
    field: 'JMComic.authorNameBlacklist.enable',
    label: '启用作者名称黑名单',
    helpMessage: '启用后每次下载前会额外查询一次本子详情，会影响响应速度',
    bottomHelpMessage: '更改即时生效',
    component: 'Switch',
  },
  tags(
    'JMComic.authorNameBlacklist.names',
    '作者名称黑名单',
    '逐项添加禁止下载的作者名称，英文不区分大小写',
    'jmv 最多获取前 10 个作者，仅检查这些可见作者',
  ),
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

  group('VV 说设置'),
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

  group('AI 图片识别设置'),
  {
    field: 'aiImage.enable',
    label: '启用',
    helpMessage: '是否启用 AI 图片来源检测',
    bottomHelpMessage: '更改即时生效',
    component: 'Switch',
  },
  {
    field: 'aiImage.proxy.enable',
    label: 'API 使用代理',
    helpMessage: 'OpenAI、Hive 和 Sightengine API 请求使用全局代理地址',
    bottomHelpMessage: '图片下载和本地 C2PA 检测始终直连',
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
  tags(
    'aiImage.openai.apiKeys',
    'OpenAI API keys',
    '逐项添加 OpenAI API key',
    '401/403/404/429 时自动尝试下一个 key',
  ),
  {
    field: 'aiImage.hive.enable',
    label: 'Hive AI 检测',
    helpMessage: '使用 Hive V3 AI Image + Deepfake Classifier',
    bottomHelpMessage: '需要 Hive V3 Secret Key',
    component: 'Switch',
  },
  tags(
    'aiImage.hive.apiKeys',
    'Hive V3 Secret Keys',
    '只填写创建 V3 API Key 时显示的 Secret Key',
    '401/403/429 时自动尝试下一个 Secret Key',
  ),
  {
    field: 'aiImage.sightengine.enable',
    label: 'Sightengine 备用检测',
    helpMessage: '使用 Sightengine genai 模型作为可选第二意见',
    bottomHelpMessage: '默认关闭',
    component: 'Switch',
  },
  tags(
    'aiImage.sightengine.credentials',
    'Sightengine 凭据',
    '逐项添加 JSON 对象，例如 {"apiUser":"user","apiSecret":"secret"}',
    '401/403/429 时自动尝试下一组凭据',
  ),

  group('图片 EXIF 定位设置'),
  {
    field: 'imageExif.enable',
    label: '启用',
    helpMessage: '自动提取收到图片的 EXIF 定位并回复解析后的位置',
    bottomHelpMessage: '默认关闭；图片无 GPS 或解析失败时不会回复',
    component: 'Switch',
  },
  {
    field: 'imageExif.allowPrivate',
    label: '允许私聊',
    helpMessage: '是否在私聊收到图片时自动检查 EXIF 定位',
    bottomHelpMessage: '仅在功能启用时生效',
    component: 'Switch',
  },
  tags(
    'imageExif.allowedGroups',
    '群聊白名单',
    '逐项添加允许自动检查图片 EXIF 的群号',
    '空列表不允许任何群聊；请先确认群成员知悉位置隐私风险',
  ),
  {
    field: 'imageExif.honorific',
    label: '称谓',
    helpMessage: '添加在群名片或昵称后的称谓',
    bottomHelpMessage: '默认“先生”；可改为“朋友”或留空，不会自动推断性别',
    component: 'Input',
  },
  {
    field: 'imageExif.timeoutMs',
    label: '请求超时毫秒数',
    helpMessage: '图片下载和反向地理编码请求的最大等待时间',
    bottomHelpMessage: '更改即时生效，默认 10000，最大 60000',
    component: 'InputNumber',
  },
  {
    field: 'imageExif.maxFileSize',
    label: '图片大小上限',
    helpMessage: '允许下载并读取 EXIF 的最大字节数',
    bottomHelpMessage: '更改即时生效，默认 20971520（20 MiB）',
    component: 'InputNumber',
  },
  {
    field: 'imageExif.geocodingEndpoint',
    label: '反向地理编码地址',
    helpMessage: '兼容 Nominatim reverse API 的 HTTPS 地址',
    bottomHelpMessage: '默认留空；请配置自建或已获授权处理图片坐标的服务',
    component: 'Input',
  },
  {
    field: 'imageExif.attribution',
    label: '位置数据署名',
    helpMessage: '成功回复第二行展示的数据来源或许可署名',
    bottomHelpMessage: '按地理编码服务和底层地图数据的许可要求填写',
    component: 'Input',
  },
  {
    field: 'imageExif.proxy.enable',
    label: '地理编码使用代理',
    helpMessage: '反向地理编码请求是否使用全局代理地址',
    bottomHelpMessage: '图片下载始终直连',
    component: 'Switch',
  },

  group('EDU 认证设置'),
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

  group('HTTP 服务器设置'),
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

  group('随机背景图设置'),
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

  group('其他设置'),
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
]

export function getGuobaSchemas() {
  return structuredClone(schemas)
}
