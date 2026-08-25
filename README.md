<div align=center>

[![State-of-the-art Shitcode](https://img.shields.io/static/v1?label=State-of-the-art&message=Shitcode&color=7B5804)](https://github.com/TomyJan/Yunzai-TomyJan-Plugin)

# Yunzai-TomyJan-Plugin

</div>

[Yunzai-TomyJan-Plugin (TJ插件)](https://github.com/TomyJan/Yunzai-TomyJan-Plugin) 是 [Yunzai-Bot](https://github.com/yoimiya-kokomi/Miao-Yunzai) 的 一个 TomyJan 自用插件, 具体介绍见 [功能介绍](#功能介绍)

## 安装与维护

项目只在 GitHub 提供功能交流等, 不通过任何渠道提供技术支持

安装前请先 [前往GitHub](https://github.com/TomyJan/Yunzai-TomyJan-Plugin/) 点一下右上角的 Star, 这对我非常重要, 谢谢喵~

### 安装插件

本插件*不兼容*也*不会兼容* trss 这种插后门的东西，执意要使用此框架请另寻替代

插件更新强依赖 Git, 建议通过 Git 安装

#### 通过 Git 安装

在 Yunzai 根目录运行命令拉取插件:

```shell
git clone https://github.com/TomyJan/Yunzai-TomyJan-Plugin.git ./plugins/Yunzai-TomyJan-Plugin/
```

#### 自行下载安装

下载插件包, 解压至 Yunzai `./plugins` 目录内并重命名文件夹为 `Yunzai-TomyJan-Plugin`

### 安装依赖

```shell
pnpm -C ./plugins/Yunzai-TomyJan-Plugin/ --ignore-workspace install --frozen-lockfile
pnpm -C ./plugins/Yunzai-TomyJan-Plugin/ --ignore-workspace test:c2pa
```

本插件当前要求 Node.js 22 或更高版本。
`--ignore-workspace` 用于确保 pnpm 使用插件自己的锁文件和原生依赖构建配置。

外部依赖:

`JMComic 下载` 功能依赖 [`hect0x7/JMComic-Crawler-Python`](https://github.com/hect0x7/JMComic-Crawler-Python), 请先前往此项目按照说明在系统全局安装此工具:

```shell
pip install jmcomic -U --break-system-packages
```

安装问题请自行解决, 不提供任何支持

### 更新插件

[更新日志](/CHANGELOG.md)

如通过 Git 安装, 在 Yunzai 根目录运行以下命令即可

```shell
git -C ./plugins/Yunzai-TomyJan-Plugin/ pull
pnpm -C ./plugins/Yunzai-TomyJan-Plugin/ --ignore-workspace install --frozen-lockfile
pnpm -C ./plugins/Yunzai-TomyJan-Plugin/ --ignore-workspace test:c2pa
```

如果 C2PA 检测提示本地组件不可用，可重新安装其原生绑定：

```shell
pnpm -C ./plugins/Yunzai-TomyJan-Plugin/ --ignore-workspace rebuild @contentauth/c2pa-node
pnpm -C ./plugins/Yunzai-TomyJan-Plugin/ --ignore-workspace test:c2pa
```

如为手动安装, 需要先备份插件 [数据目录](#数据目录) , 删除旧插件并解压新的插件后, 再将插件 [数据目录](#数据目录) 恢复进去, 即可完成更新

### 数据目录

`./config` 为插件配置目录

`./data` 为插件用户数据目录, 若你开启了 `JMComic` 的存档功能, 则需要备份 `./data/JMComic/archive` 目录, 这是你的存档数据.
其他的, `./data/system` 为插件系统数据, `./data/JMComic` 为 `JMComic` 功能的系统和缓存数据, `./data/httpServer` 为 插件内置服务器的系统和缓存数据, 不用备份

### 插件配置

建议通过 [锅巴插件](https://gitee.com/guoba-yunzai/guoba-plugin) 进行配置. 当然, 你也可以自己配置, 默认配置文件位置 `./data/system/default_config.json`, 配置文件位置 `./config/config.json`, 配置项默认值及其作用:

```json
{
  "logger": {
    // 插件的日志器配置
    "logLevel": "info", // 日志等级, 可选值: trace, debug, info, warn, error, fatal
    "saveToFile": false // 是否保存日志到文件
  },
  "proxy": {
    // 全插件共用的代理设置
    "url": "", // HTTP 或 HTTPS 代理地址, 为空则不使用
    "autoUpdate": false, // 插件自动更新是否使用代理
    "randomBackground": false // 随机背景下载是否使用代理
  },
  "JMComic": {
    // JMComic 功能配置
    "enable": true, // 是否启用 JMComic 功能
    "pdfPassword": "", // PDF 密码, 为空则不加密, 如果同时开启下方归档 PDF 功能, 请请确保设置的密码没有不可用于文件名的字符
    "sendPdfPassword": false, // 是否发送 PDF 密码, 仅在 `pdfPassword` 不为空时生效
    "sendFilePolicy": 1, // 发送文件策略, 0=只发文件, 1=优先文件, 2=只发链接
    "archiveDownloadedImg": false, // 是否归档下载的图片到 `./data/JMComic/archive/download/`, 若开启, 归档将同时将用作下载加速
    "archiveConvertedPdf": false, // 是否归档转换后的 PDF 到 `./data/JMComic/archive/convert/`, 若为加密 PDF 则文件名会加上密码, 请确保设置的密码没有不可用于文件名的字符
    "proxy": { "enable": false }, // 是否使用上方统一代理, 开启后会同步至 JMComic option.yml
    "albumIdBlacklist": {
      "enable": false,
      "ids": []
    },
    "authorNameBlacklist": {
      "enable": false,
      "names": []
    }
  },
  "vvShuo": {
    // VV 说 功能配置
    "enable": true, // 是否启用 VV 说 功能
    "proxy": { "enable": false } // 是否使用上方统一代理
  },
  "eduAuth": {
    // EDU Auth 功能配置
    "enable": false, // 是否启用 EDU Auth 功能
    "apiBaseUrl": "https://edu.amoe.cc/api/v2/thirdParty", // EDU Auth API 基础 URL
    "apiKey": "your-api-key", // EDU Auth API 密钥
    "userGroup": 725571000, // 用户群群号
    "adminGroup": 725571000, // 管理群群号
    "proxy": { "enable": false } // 是否使用上方统一代理
  },
  "aiImage": {
    // AI 图片识别配置
    "enable": false, // 是否启用 AI 图片识别
    "timeoutMs": 15000, // 图片下载和单个检测渠道的超时时间
    "maxFileSize": 52428800, // 图片大小上限, 默认 50 MiB
    "proxy": { "enable": false }, // 外部检测 API 是否使用上方统一代理
    "c2pa": { "enable": true }, // 是否启用本地 C2PA 检测
    "openai": { "enable": true, "apiKeys": [] }, // OpenAI API Key 列表
    "hive": { "enable": true, "apiKeys": [] }, // Hive V3 Secret Key 列表
    "sightengine": { "enable": false, "credentials": [] } // Sightengine 凭据列表
  },
  "imageExif": {
    // 图片 EXIF 定位自动回复配置
    "enable": false, // 是否自动检查收到图片的 EXIF GPS
    "provider": "nominatim", // nominatim 或 amap
    "honorific": "先生", // 昵称后的称谓，可设为“朋友”或空字符串
    "timeoutMs": 10000, // 图片下载和地理编码超时
    "maxFileSize": 20971520, // 图片大小上限，默认 20 MiB
    "geocodingEndpoint": "https://nominatim.openstreetmap.org/reverse", // Nominatim reverse API
    "amap": { "apiKeys": [] }, // 高德开放平台 Web 服务 Key 列表
    "proxy": { "enable": false } // 反向地理编码是否使用上方统一代理
  },
  "httpServer": {
    // 插件内置 HTTP 服务器配置
    "enable": false, // 是否启用 HTTP 服务器, 建议手动启用并修改相关配置
    "listenPort": 5252, // 监听端口
    "accessUrl": "http://127.0.0.1:5252/" // 访问 URL
  },
  "useRandomBgInCard": true, // 卡片是否使用随机背景图
  "attemptSendNonFriend": true, // 即使非好友也尝试推送消息
  "botQQ": 0 // 机器人 QQ 号, 使用第三方适配器或者其他多账号框架时可能需要配置
}
```

#### JMComic 黑名单配置

本子 ID 黑名单和作者名称黑名单拥有独立开关，可以只启用其中一项。建议通过锅巴配置；也可以编辑 `config/config.json`：

```json
{
  "JMComic": {
    "albumIdBlacklist": {
      "enable": true,
      "ids": ["123", "456"]
    },
    "authorNameBlacklist": {
      "enable": true,
      "names": ["example", "Alice"]
    }
  }
}
```

- 本子 ID 会按十进制数字字符串匹配并忽略前导零，数字值和字符串值等价。
- 作者名称去除首尾空白后进行完整匹配，英文名称不区分大小写，不使用包含或模糊匹配。
- 启用作者名称黑名单后，每次下载前会通过 `jmv` 额外查询一次本子详情，因此会增加等待时间。
- `jmv` 最多输出前 10 个作者，作者名称黑名单只能检查这些可见作者。
- 作者前置查询失败、没有输出或无法解析作者字段时会停止下载，不会继续创建缓存或执行下载。
- 该功能复用 `jmcomic` 安装时提供的 `jmv`，插件不会新增 `.py` 文件、npm 依赖或额外 Python 依赖。

#### AI 图片识别配置

`ai图` 功能默认关闭。建议在锅巴中配置；也可以编辑 `config/config.json`：

```json
{
  "proxy": {
    "url": "http://127.0.0.1:7890"
  },
  "aiImage": {
    "enable": true,
    "timeoutMs": 15000,
    "maxFileSize": 52428800,
    "proxy": { "enable": false },
    "c2pa": { "enable": true },
    "openai": {
      "enable": true,
      "apiKeys": ["sk-...", "sk-..."]
    },
    "hive": {
      "enable": true,
      "apiKeys": ["Hive V3 Secret Key"]
    },
    "sightengine": {
      "enable": false,
      "credentials": [{ "apiUser": "123456789", "apiSecret": "..." }]
    }
  }
}
```

- **C2PA：** 本地读取并验证 Content Credentials，无需申请 API Key，也不会请求外部检测服务。
- **OpenAI：** 在 [OpenAI Platform](https://platform.openai.com/api-keys) 创建 API Key，授予 Model capabilities -> Images (/v1/images) 即可，调用 [Content Provenance API](https://developers.openai.com/api/docs/guides/content-provenance) 检查 OpenAI 支持的 C2PA 和 SynthID 信号。该接口可能尚未向所有组织开放；未开放时会返回 HTTP 404。官方未公布固定免费额度，可在账户的用量和限额页面查看实际权限。
- **Hive V3：** 在 [Hive 控制台](https://thehive.ai/) 创建 V3 API Key 时会得到 Access Key (AK) 和 Secret Key (SK)。AK 是控制台中的公开标识，不参与接口鉴权；本插件的 `apiKeys` **只填写 SK**，请求使用 `Authorization: Bearer <SK>`。AI 图片检测公开标价为每 1000 张 6 美元，官方未承诺固定免费额度，实际额度以控制台为准。
- **Sightengine：** 在 [Sightengine 控制台](https://dashboard.sightengine.com/) 的 API Credentials 页面获取 `api_user` 和 `api_secret`，按一组一个 JSON 对象填写。免费试用量和正式价格以 [价格页](https://sightengine.com/pricing) 及账户控制台为准。

OpenAI 和 Hive 的 `apiKeys`、Sightengine 的 `credentials` 都可以配置多项。每次识别会轮换起始凭据；当前凭据遇到鉴权失败或限流时，会自动尝试下一项。启用了多少个检测渠道，每张图片就会并行使用多少个渠道，它们不是主备关系。

#### 图片 EXIF 定位配置

该功能默认关闭，支持 Nominatim 兼容接口和高德开放平台。默认提供商是 `nominatim`，默认 endpoint 为 OSMF 公共 reverse API；切换到 `amap` 后需要填写至少一个高德 Web 服务 Key。启用后会自动检查所有群聊和私聊中的图片 EXIF GPS，也支持 QQ 以文件消息发送的 HEIF/HEIC 图片。请确认图片发送者知悉坐标会提交给所选位置服务商。

高德配置示例：

```json
{
  "imageExif": {
    "enable": true,
    "provider": "amap",
    "amap": {
      "apiKeys": ["你的高德 Web 服务 Key"]
    }
  }
}
```

- 图片只下载到内存，不保存图片、EXIF、坐标或地理编码响应；HEIF/HEIC 文件可通过适配器的 `get_file` 接口读取临时 URL 或本地缓存。插件不会直接读取消息段提供的本地路径。日志也不会记录图片 URL、本地路径、坐标、地点、昵称、API Key 或完整响应。
- 图片无 GPS、图片被平台压缩清除 EXIF、下载失败或地理编码失败时不会回复。
- 有效地点会按省/直辖市、城市、区县、乡镇/街道逐层去重，例如：`请问是上海市松江区泗泾镇的小明 先生吗？`
- 称呼优先使用群名片，其次使用发送者昵称，最后回退为“朋友”。`honorific` 默认是“先生”，可改成中性的“朋友”或留空；插件不会推断性别。
- 公共 Nominatim 受 [OSMF 使用政策](https://operations.osmfoundation.org/policies/nominatim/) 约束。插件使用明确的 User-Agent、单请求队列、一小时缓存，并将 Nominatim 请求限制为每秒最多一次；管理员仍需自行确认图片内容、总调用量和使用场景符合政策。需要更稳定的服务等级时，请改用自建或商业 Nominatim 兼容服务。
- 高德调用固定使用官方 HTTPS 逆地理编码接口，并在请求前将 EXIF 的 WGS-84 坐标转换为高德使用的 GCJ-02 坐标。高德当前为符合条件的个人非商业开发者提供基础 LBS 月配额，但商业用途、技术服务许可、免费期限、QPS 和配额均以 [官方定价说明](https://lbs.amap.com/upgrade#price) 与 [高德开放平台控制台](https://console.amap.com/) 为准，插件不承诺免费或无限调用。
- 高德 `apiKeys` 支持多项并轮换起始 Key。当前 Key 遇到鉴权、配额或限流类错误时，会自动尝试下一项；参数错误或无法识别的响应不会盲目轮换。
- 插件最多并发处理 2 张图片；地理编码最多排队 20 条、缓存 500 个坐标一小时。Nominatim 每秒最多请求一次，高德请求仍通过统一队列并受账号配额约束。繁忙时新图片会静默跳过。
- `imageExif.proxy.enable` 控制 Nominatim 和高德反向地理编码请求是否使用统一代理；图片下载始终直连，并沿用私网地址阻断、重定向次数、超时和大小限制。

日志使用 `[图片EXIF]` 前缀并遵循全局 `logger.logLevel`：

- `debug`：任务数量、输入来源、缓存命中、队列数量、请求尝试和跳过原因。
- `info`：处理开始、图片格式与大小、各阶段耗时、发现 GPS、位置查询成功和回复完成。
- `warn`：缺少高德 Key、队列已满、HTTP/API 失败、响应无法识别或没有可用位置。
- `error`：图片读取、EXIF 解析、DNS、连接、代理、TLS、超时或 JSON 解析异常，只记录安全分类。

全插件只配置一个代理地址 `proxy.url`，各功能分别通过自己的 `proxy.enable` 决定是否使用。`aiImage.proxy.enable` 只控制 OpenAI、Hive 和 Sightengine API；待检测图片下载（包括重定向）和本地 C2PA 始终直连。`JMComic.proxy.enable` 开启后，插件会将统一代理地址同步到 `data/JMComic/option.yml` 的 `client.postman.meta_data.proxies`。

## 功能介绍

插件帮助信息 `#TJ帮助` `tjhelp` , 所有指令的 `#` 前缀均可省略

### JMComic 下载

- `#jm 1112863` 下载 JMComic 漫画并转换为 PDF 发送, 发送失败可选临时上传到插件内置 HTTP 服务器供用户下载
  注意大概由于 ICQQ 协议问题, 文件有相当大的概率发送失败, 建议配置启用插件内置 HTTP 服务器作为备用方案

### VV 说

- `#vv说赢` 返回最匹配的两条 VV 表情包

### AI 图片识别

- `ai图` / `#ai图`：发送命令并附带一张图片，或引用一条图片消息后发送命令；`ai` 不区分大小写。
- 本地检查 C2PA Content Credentials，并可调用 OpenAI Content Provenance API、Hive V3 和 Sightengine。所有已启用渠道都会执行。
- 结果会区分可信来源凭证、概率模型检测、未检测到、渠道不可用和请求失败。`未检测到` 只表示当前渠道没有发现它支持的信号，不能证明图片一定不是 AI 生成。
- 图片只在内存中处理，不持久化保存；QQ 压缩、截图、裁剪或转码可能清除 C2PA 元数据和水印，导致证据不足。

### 图片 EXIF 定位

- 功能启用后，所有群聊和私聊收到图片时都会自动提取 EXIF GPS，通过 Nominatim 或高德反向解析位置，并与群名片或昵称组合成问候消息。
- 支持普通图片消息，以及 QQ 作为文件发送的 `.heif`、`.heic` 图片。无 GPS 或任一处理阶段失败时不回复。
- 位置元数据属于敏感信息，启用前请确认使用场景。机器人不会保存或记录解析出的坐标和地点。

### EDU Auth

- `#edu 100.xx.xx.xx` 进行某些认证, 内部服务, 别问

## 关于

### 免责声明

- 功能仅限内部交流与小范围使用，请勿将 Yunzai-TomyJan-Plugin 及其组件和衍生项目用于任何以盈利为目的的场景
- 图片与其他素材均来自于网络，仅供交流学习使用，如有侵权请联系处理

### 贡献/帮助

有 bug? 要新功能? [提交 Issue](https://github.com/TomyJan/Yunzai-TomyJan-Plugin/issues/new/choose)

帮助我开发? [提交 PR](https://github.com/TomyJan/Yunzai-TomyJan-Plugin/compare)

插件有帮到你? [给我打赏](https://donate.tomys.top)

### 一起玩

[TG](https://t.me/TomyJan) | [Q 闲聊群](https://qun.tomys.top)

### 链接

- [yoimiya-kokomi/Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai)
- [TomyJan/Yunzai-Kuro-Plugin](https://github.com/TomyJan/Yunzai-Kuro-Plugin)

### 致谢

- [hect0x7/JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python)
- [MemeMeow-Studio/MemeMeow](https://github.com/MemeMeow-Studio/MemeMeow)
