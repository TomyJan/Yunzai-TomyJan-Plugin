# 图片 EXIF 定位自动回复设计

## 目标

在功能显式启用且消息场景获准时，对收到的第一张图片进行内存下载和 EXIF GPS 提取。图片包含有效坐标时，通过反向地理编码得到省、市、区县、乡镇等地点信息，并回复：

`请问是上海市松江区 xx 镇的 xx 先生吗？`

没有 GPS、无法下载、EXIF 无效或地理编码失败时不打扰用户，只记录不含坐标和图片 URL 的脱敏日志。

## 方案选择

采用“专用 EXIF 解析库 + Nominatim/高德双反向地理编码提供商 + 纯逻辑分层”。相比手写 TIFF/EXIF 二进制解析，这种方案对不同厂商、字节序和 GPS Rational 格式更稳健。Nominatim 是默认提供商，默认 endpoint 为 OSMF 公共 reverse API，并严格执行每秒最多一次、缓存、User-Agent 和署名要求；管理员须确保图片坐标符合公共服务政策。高德使用 Web 服务 Key 数组和固定官方 endpoint，在同一请求内只对鉴权、配额或限流错误轮换 Key。

不采用 `sharp.metadata().exif` 后手写 TIFF 解析，因为 Sharp 只暴露原始 EXIF Buffer。除 Nominatim 与高德外，不增加其他地图提供商，避免配置和响应适配范围继续扩张。

## 架构

- `model/imageExifLocation.js`：从图片 Buffer 提取 GPS；校验坐标；按配置调用 Nominatim 或高德；规范化中文地址层级；缓存、节流与 Key 轮换；格式化回复。网络和 EXIF reader 均可注入以便确定性测试。
- `model/imageExifPolicy.js`：判断私聊/群聊白名单是否允许触发；从群名片、发送者昵称、事件昵称依次选择称呼；清理控制字符和过长文本。
- `apps/imageExif.js`：注册普通消息监听，检查配置和图片段，下载第一张图，调用上述模型并回复。应用层不包含解析或决策细节。
- 复用 `model/aiImage.js` 已验证过 SSRF、重定向、超时、类型和大小限制的 `downloadImage`；图片下载始终直连。反向地理编码使用 `imageExif.proxy.enable` 决定是否使用全局 `proxy.url`。

## 配置契约

新增 `imageExif`：

```json
{
  "enable": false,
  "provider": "nominatim",
  "allowPrivate": true,
  "allowedGroups": [],
  "honorific": "先生",
  "timeoutMs": 10000,
  "maxFileSize": 20971520,
  "geocodingEndpoint": "https://nominatim.openstreetmap.org/reverse",
  "attribution": "",
  "amap": { "apiKeys": [] },
  "proxy": { "enable": false }
}
```

默认关闭，提供商默认为 `nominatim`。群聊只有群号位于 `allowedGroups` 才触发；空数组不允许任何群。锅巴使用 `GTags` 编辑群号白名单与高德 Key 数组。`honorific` 可设为“朋友”、其他称谓或空字符串，不根据昵称推断性别。`attribution` 非空时覆盖提供商默认署名；留空时 Nominatim 显示 `© OpenStreetMap contributors`，高德显示“高德开放平台”。配置同步到默认配置、锅巴 schema、README 和契约测试。

## 数据流

1. Yunzai 收到消息，规则进入 `handleImage`。
2. 配置未启用、场景不允许或当前消息无图片时立即返回 `false`。
3. 优先提取当前消息段中的图片 URL，并兼容 Yunzai 的 `e.img` URL 数组；不追溯引用消息，自动功能只处理真正收到的图片。
4. 安全下载第一张图片到内存，并用 EXIF reader 读取 GPS。
5. 坐标有效时，根据 `provider` 选择 Nominatim 或高德，以提供商和小数点后五位坐标作为缓存键进入反向地理编码队列；成功缓存最多保留 500 条和一小时，待处理请求最多 20 条。
6. Nominatim 发送 `lat`、`lon`、`format=jsonv2` 等参数；高德先将 EXIF 的 WGS-84 坐标转换为 GCJ-02，再发送 `location=经度,纬度`，并将 `regeocode.addressComponent` 转换为统一地址字段。高德仅在可重试的鉴权、配额或限流错误时换用下一个 Key。
7. 从统一地址中按中国行政区语义选择并去重省/直辖市、城市、区县、乡镇/街道/村。地点至少包含一个有意义字段才回复。
8. 称呼按群名片、`sender.nickname`、事件昵称、“朋友”的顺序选择，拼成最终消息。

## 安全与错误处理

- 不持久化图片、EXIF、坐标或地理编码响应。
- 日志不包含图片 URL、经纬度、用户昵称或地理位置；只记录阶段和错误类别。
- 地理编码地址、昵称和称谓均移除控制字符、双向格式字符及 CQ 码，折叠空白并限制长度。
- 下载继承现有私网地址阻断、重定向上限、类型/大小限制和超时。
- Nominatim endpoint 必须是 HTTPS；请求仅包含经纬度、语言和输出格式，不发送用户标识。使用公共实例时管理员负责确认用途符合其政策。
- 高德 endpoint 固定为官方 HTTPS 地址；Key 只进入请求参数，不写入日志或回复，默认配置不得包含真实 Key。
- 日志按 `debug/info/warn/error` 分级记录提供商、阶段、耗时、HTTP 状态和 Key 尝试序号，不记录图片 URL、经纬度、地点、昵称、Key 或完整响应。
- 地理编码非 2xx、响应无效、无 GPS 或解析失败均静默跳过，不向聊天发送错误消息。
- 完整图片工作流最多并发 2 个任务，超出的消息静默跳过，避免图片下载和内存处理被滥用。
- 地理编码最多保留 20 个待处理请求；同一进程缓存最多 500 个相同五位小数坐标且一小时过期；串行请求间隔至少一秒。

## 测试

- GPS：有效值、零度边界、越界、无 EXIF、reader 异常。
- 地址：直辖市、普通省市、字段去重、乡镇缺失、无有效地址。
- 地理编码：Nominatim URL 参数、请求头、公共默认 endpoint、代理、超时、非 2xx、缓存、节流。
- 高德：GPS 请求参数、响应规范化、无 Key、Key 轮换、不可重试错误和敏感日志清理。
- 策略：私聊开关、群白名单的数字/字符串兼容、非聊天事件、称呼优先级和清洗。
- 应用编排：无图片不下载；GPS 图片回复；无 GPS 和失败路径静默；只处理第一张图。
- 配置：默认值、锅巴卡片字段、README 说明、核心模块覆盖率范围。
