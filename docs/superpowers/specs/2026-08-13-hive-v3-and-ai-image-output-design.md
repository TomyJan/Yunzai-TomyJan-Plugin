# Hive V3 与 AI 图片识别输出设计规格

## 目标

将 AI 图片识别中的 Hive 渠道完整迁移到自助式 V3 API，补齐配置说明与安全日志，并让机器人回复更容易阅读。此次改动不保留 Hive V2 端点、Token 鉴权、V2 响应兼容或旧单 Key 迁移逻辑。

## Hive V3 契约

Hive 控制台创建 V3 API Key 后会同时展示 Access Key（AK）和 Secret Key（SK）。官方文档说明请求使用 SK，Playground 生成的请求也只包含：

```http
POST /api/v3/hive/ai-generated-and-deepfake-content-detection
Authorization: Bearer <SECRET_KEY>
Content-Type: multipart/form-data; boundary=...
```

AK 是控制台中的公开标识，不参与请求鉴权。现有 `aiImage.hive.apiKeys` 保持字符串数组结构，但数组元素的语义改为 V3 SK。锅巴与 README 均明确只填写 SK，不要求保存 AK。

请求直接上传图片二进制：

```text
media=<图片二进制>
processing_mode=sync_with_fallback
```

插件先下载并校验图片，再将同一个 Buffer 直接上传给 C2PA、OpenAI、Hive 和 Sightengine。Hive 的 V3 接口要求图片字段名为 `media`；不能使用 `image` 字段或 Data URL。直接上传还能避免 Hive 二次抓取 QQ 等平台的临时图片 URL，消除该链路引起的超时。

V3 响应从 `output[].classes[]` 读取，分数位于 `value`。`ai_generated` 和 `deepfake` 使用 Hive 官方建议的 `0.9` 阈值；生成来源取排除结果类后的最高分项。归一化器只支持 V3 响应结构。

## 日志

一次识别记录以下过程：

1. 开始检测。
2. 图片下载完成后的 MIME、字节数与下载耗时。
3. 每个启用渠道的开始、完成状态与耗时。
4. 最终结论、可信度与总耗时。

渠道失败记录 HTTP 状态、归一化原因或脱敏错误。日志不得包含图片 URL、URL 查询参数、API Key、SK、Sightengine 凭据、请求体或完整外部响应。模型层接受可注入 logger，机器人入口传入插件现有的 `tjLogger`，测试使用内存 logger 验证顺序与脱敏。

## 回复排版

回复使用固定标题、结论、可信度、渠道列表和风险提示：

```text
🔎 AI 图片识别结果

⚠️ 结论：检测到 AI 生成或篡改信号（概率模型）
📊 可信度：中

检测渠道：
ℹ️ C2PA：未检测到
ℹ️ OpenAI：未检测到
✅ Hive：AI 生成概率 97.6%（flux 87.3%，Deepfake 31.4%）
ℹ️ Sightengine：AI 生成概率 8.2%

ℹ️ 未检出不代表图片一定不是 AI 生成。
```

图标含义固定：检测到为 `✅`，未检出为 `ℹ️`，未配置或不可用为 `⏸️`，失败为 `❌`。可信来源凭证保持高可信度，概率模型命中为中可信度，其余为低可信度。

## README

README 简要说明命令、四个渠道、凭据格式、轮换、代理和判断局限。Hive 部分明确：

- V3 Key 在 Hive 登录后的 `API Keys` 页面创建。
- AK 仅作控制台标识，插件只填写 SK。
- V3 请求按量计费；AI 图片检测页面当前标价为每 1000 张 6 美元。
- 官方未承诺 AI 图片检测有固定免费请求数，实际试用与限额以账户页面为准。

## 测试与提交

测试覆盖 V3 端点、Bearer SK、`media` 二进制上传、`value` 响应、0.9 阈值、多 SK 轮换、旧 Hive 单 Key 丢弃、日志过程与脱敏、各渠道具体证据排版，以及仓库中不存在 Hive V2 端点或 Token 鉴权。先提交规格与计划，再提交实现、测试和 README，确保功能提交原子化。
