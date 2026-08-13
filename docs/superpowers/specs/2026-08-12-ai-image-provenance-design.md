# AI 图片识别与全插件代理设计规格

## 目标

新增 `ai图` 消息功能：用户引用一张图片发送 `ai图`，或直接发送 `ai图` 与图片，插件检查图片的内容来源和 AI 生成信号，并以分层证据回复。命令匹配不区分大小写，兼容可选 `#` 前缀。

## 证据渠道

1. `@contentauth/c2pa-node`：Node 22 环境下本地读取并验证 C2PA manifest。它是来源签名证据；有效且受信任的 AI 生成声明可作为确认级结果。
2. OpenAI Content Provenance API：调用官方 `POST /v1/content_provenance_checks`，上传原图，读取 OpenAI 支持的 C2PA 与 SynthID 结果。该 API 只检测受支持的 OpenAI 信号，不是通用 AI 检测器；不模拟网页验证器。
3. Hive AI Image + Deepfake Classifier：上传图片取得 `ai_generated`、`not_ai_generated` 和生成器来源概率，并保留 deepfake 结果（若响应提供）。这是概率证据，不与签名证据混为一谈。
4. Sightengine `models=genai`：可选的第二意见 provider，默认关闭；返回结果按 provider 原样归一化为概率证据。

网页模拟、EXIF 字段、文件名、反向搜图和长期不更新的本地分类模型不属于首版判定渠道。Google SynthID Detector 门户仍处于早期测试，未来有正式 API 时再添加 provider。

## 数据流

消息规则识别后，先从当前消息段提取图片；若没有图片，再从引用消息的 `message`/`raw_message` 中提取图片。下载图片到内存或临时文件，限制大小和超时，检测结束后删除临时文件。各 provider 独立执行，单个失败不阻断其他结果。

所有 provider 返回统一结果：`provider`、`status`（`detected`、`not_detected`、`unavailable`、`error`）、`confidence`、`signals`、`details`。汇总器按证据层级生成中文回复：可信签名/水印结果优先，概率模型作为补充；`not_detected` 只能表示未发现该渠道支持的信号，不能表示“确定不是 AI”。

## 配置

插件根配置新增唯一代理地址 `proxy.url`。各功能只保存是否使用该代理的开关，不重复保存地址：

- `JMComic.proxy.enable`：控制 JMComic 下载。
- `vvShuo.proxy.enable`：控制 VV 说 API。
- `eduAuth.proxy.enable`：控制 EDU 认证 API。
- `aiImage.proxy.enable`：同时控制图片下载及 OpenAI、Hive、Sightengine 请求；C2PA 为本地解析，不使用代理。
- `proxy.autoUpdate`：控制自动检查更新；该功能没有独立配置组，因此开关放在代理设置组。
- `proxy.randomBackground`：控制随机背景图下载；该功能没有独立配置组，因此开关放在代理设置组。

代理开关开启但 `proxy.url` 为空时，请求保持直连并记录警告。Node.js 网络请求统一通过 `undici.ProxyAgent` 设置 dispatcher。JMComic 是外部 Python 工具，每次下载前用 YAML 解析器同步 `data/JMComic/option.yml`：开启时设置 `client.postman.meta_data.proxies`，关闭时仅删除该字段，并保留文件中的其他用户配置。

`aiImage` 新增 `enable`、`timeoutMs`、`maxFileSize`、`proxy.enable`、`c2pa.enable`、`openai.enable/apiKeys`、`hive.enable/apiKeys`、`sightengine.enable/credentials`。OpenAI 与 Hive 只接受 `apiKeys` 数组，不保留单个 `apiKey`；Sightengine 只接受 `credentials` 数组，不保留单个 `apiUser` 和 `apiSecret`。多个 key 或凭据按轮询顺序使用，遇到 401、403、429 时自动尝试下一个。默认功能关闭，凭据为空时对应 provider 状态为 `unavailable`。锅巴配置提供全部开关、凭据、代理地址和限制项。

## 兼容性和错误处理

项目 `engines.node` 升级为 `>=22`。图片格式仅接受 PNG、JPEG、WebP；超限、下载失败、引用消息无图、API 401/403/404/429 和超时均回复可读的状态，不泄露密钥或完整远端响应。图片内容不落盘持久化。

## 测试范围

测试全局代理配置、各功能独立代理开关、JMComic YAML 的开启/关闭同步及用户配置保留、图片段和引用消息提取、命令正则、C2PA JSON 归一化、OpenAI/Hive/Sightengine 凭据轮换与响应归一化、provider 独立失败、汇总判定和超时。网络请求通过注入 fetch/transport 测试，不访问真实服务。

## 提交策略

以 `55fdd19` 为基线重写本地 AI 图片相关历史，丢弃原有两个未推送提交的边界划分，并把当前未提交内容纳入对应原子提交：

1. 全插件统一代理基础能力和测试。
2. AI 图片配置、消息解析和设计文档。
3. AI 图片检测 provider、轮换逻辑和测试。

每个提交都必须能独立通过其覆盖范围内的测试和静态检查，不混入无关格式化或历史文件修改。
