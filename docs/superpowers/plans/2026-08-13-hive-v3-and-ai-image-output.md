# Hive V3 与 AI 图片识别输出实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 Hive 检测切换到纯 V3 契约，增加不泄密的过程日志，优化机器人回复并补齐 README 配置说明。

**架构：** `model/aiImageProviders.js` 只负责各渠道协议与结果归一化；`model/aiImage.js` 编排图片下载、并发渠道和日志；`apps/aiImage.js` 注入插件 logger。配置仍使用多值数组，Hive 数组只保存 V3 SK。

**技术栈：** Node.js 22、原生 Fetch/JSON、Node Test Runner、ESLint、Prettier。

---

## 文件结构

- `model/aiImageProviders.js`：Hive V3 请求、响应归一化与回复格式。
- `model/aiImage.js`：识别生命周期和脱敏日志。
- `apps/aiImage.js`：将 `tjLogger` 注入识别编排器。
- `model/aiImageConfig.js`：删除 Hive 旧单 Key 迁移，只规范化 V3 SK 数组。
- `guoba.support.js`：将 Hive 字段说明改为 V3 Secret Key。
- `README.md`：记录使用方式、凭据、费用、代理和判断限制。
- `test/aiImageProviders.test.js`：V3 协议、阈值和轮换回归测试。
- `test/aiImageInspect.test.js`：编排与安全日志测试。
- `test/aiImageSummary.test.js`：新回复排版测试。
- `test/aiImageConfig.test.js`、`test/aiImageConfigValue.test.js`：V3 配置语义和无 V2 残留测试。

### 任务 1：锁定 Hive V3 协议

- [ ] **步骤 1：编写失败测试**

在 `test/aiImageProviders.test.js` 断言端点为 `/api/v3/hive/ai-generated-and-deepfake-content-detection`、请求头为 `Bearer <SK>`、正文是包含 `media_url` 和 `sync_with_fallback` 的 JSON，并用 `output[].classes[].value` 得到结果。

- [ ] **步骤 2：验证红灯**

运行：`node --test test/aiImageProviders.test.js`

预期：测试因当前 V2 端点、Token 鉴权和 multipart 正文失败。

- [ ] **步骤 3：实现 V3 最小代码**

将 `checkHive` 改为接收图片 URL，构造官方 V3 JSON 请求；将 Hive 归一化器限制为 `output[].classes[]` 和 `value`，AI 图片及 deepfake 阈值均为 `0.9`。

- [ ] **步骤 4：验证绿灯**

运行：`node --test test/aiImageProviders.test.js`

预期：全部通过。

### 任务 2：移除 Hive V2 配置语义

- [ ] **步骤 1：编写失败测试**

在配置测试中断言 Hive 旧 `apiKey` 被删除且不迁入 `apiKeys`；断言锅巴只称其为 V3 Secret Key；扫描生产文件不得出现 Hive `/api/v2/` 或 `Authorization: Token`。

- [ ] **步骤 2：验证红灯**

运行：`node --test test/aiImageConfig.test.js test/aiImageConfigValue.test.js`

预期：旧迁移逻辑和锅巴文案导致失败。

- [ ] **步骤 3：实现配置变更**

删除 Hive 单 Key 合并逻辑，保留 `apiKeys` 数组规范化；更新锅巴标签、帮助与轮换说明。

- [ ] **步骤 4：验证绿灯**

运行：`node --test test/aiImageConfig.test.js test/aiImageConfigValue.test.js`

预期：全部通过。

### 任务 3：增加安全过程日志

- [ ] **步骤 1：编写失败测试**

在 `test/aiImageInspect.test.js` 注入内存 logger，断言存在开始、图片信息、各渠道状态及耗时、最终结论日志；构造含 URL 和 SK 的失败，断言日志中均不可见。

- [ ] **步骤 2：验证红灯**

运行：`node --test test/aiImageInspect.test.js`

预期：当前编排器没有生命周期日志。

- [ ] **步骤 3：实现日志编排**

给 `inspectAiImage` 增加 logger/clock 依赖和脱敏辅助函数；给下载、渠道和汇总阶段写入结构化中文消息；入口传入 `tjLogger`。

- [ ] **步骤 4：验证绿灯**

运行：`node --test test/aiImageInspect.test.js`

预期：全部通过且日志断言没有泄密。

### 任务 4：优化回复排版

- [ ] **步骤 1：编写失败测试**

在 `test/aiImageSummary.test.js` 分别断言可信来源、概率命中、未检出、未配置和失败的标题、结论、可信度及固定状态图标。

- [ ] **步骤 2：验证红灯**

运行：`node --test test/aiImageSummary.test.js`

预期：当前纯文本汇总不符合新布局。

- [ ] **步骤 3：实现最小排版**

重构 `summarizeAiImageResults` 的展示文本，保留现有判定优先级，加入固定区块和图标，不把“未检出”表达成“非 AI”。

- [ ] **步骤 4：验证绿灯**

运行：`node --test test/aiImageSummary.test.js`

预期：全部通过。

### 任务 5：更新 README 并完成验证

- [ ] **步骤 1：更新 README**

补充四渠道表格、Hive AK/SK 说明、多凭据格式、代理范围、价格与免费额度边界，并更新 AI 图片功能段落。

- [ ] **步骤 2：格式和残留检查**

运行：`pnpm exec prettier --check README.md docs/superpowers/specs/2026-08-13-hive-v3-and-ai-image-output-design.md docs/superpowers/plans/2026-08-13-hive-v3-and-ai-image-output.md model/aiImageProviders.js model/aiImage.js model/aiImageConfig.js apps/aiImage.js guoba.support.js test/aiImageProviders.test.js test/aiImageInspect.test.js test/aiImageSummary.test.js test/aiImageConfig.test.js test/aiImageConfigValue.test.js`

运行：`rg -n "api/v2|Authorization:\\s*Token|hive\\.apiKey(?!s)" model apps guoba.support.js data/system/default_config.json README.md test`

预期：格式通过；第二条命令无 Hive V2 生产残留。

- [ ] **步骤 3：全量验证**

运行：`node --test`

运行：`pnpm exec eslint .`

运行：`git diff --check`

预期：所有命令退出码为 0。

- [ ] **步骤 4：代码审查与修复**

按规格检查协议、日志安全、消息语义、README 和测试覆盖；修复所有 Critical 与 Important 问题后重新执行步骤 2、3。

- [ ] **步骤 5：原子提交**

提交功能与文档变更，提交信息使用：

```text
feat(AI图片): 迁移 Hive V3 并优化识别反馈
```
