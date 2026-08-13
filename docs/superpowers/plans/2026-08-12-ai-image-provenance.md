# AI 图片识别与全插件代理实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为插件全部外部网络功能提供一个全局代理地址和独立功能开关，并实现支持多凭据轮换的 `ai图` 来源检测。

**架构：** `model/proxy.js` 统一为 Node.js fetch 请求提供缓存的 `undici.ProxyAgent`；各功能只读取自己的开关和根级 `proxy.url`。JMComic 通过 `model/jmOption.js` 结构化同步 YAML。AI 图片按消息解析、图片下载、provider、汇总四个职责组织，外部渠道共享一个功能级代理开关。

**技术栈：** Node.js 22、`undici`、`yaml`、`@contentauth/c2pa-node`、原生 `fetch`/`FormData`/`Blob`、Node.js `node:test`。

---

### 任务 1：重整本地历史

**文件：**

- Git 历史：`dev` 分支的 `aefc8f5`、`8ddd84a`

- [ ] **步骤 1：创建可恢复备份引用**

运行：`git branch backup/ai-image-before-rewrite 8ddd84a`

- [ ] **步骤 2：将两个提交还原到工作区**

运行：`git reset --mixed 55fdd19`

预期：`HEAD` 为 `55fdd19`，原提交文件全部作为未提交改动保留。

- [ ] **步骤 3：核对工作区**

运行：`git status --short` 和 `git diff --stat`

预期：没有文件丢失，且没有 `node_modules`、日志或运行时配置进入变更列表。

### 任务 2：全插件统一代理基础能力

**文件：**

- 创建：`model/proxy.js`
- 创建：`model/jmOption.js`
- 创建：`test/proxy.test.js`
- 创建：`test/jmOption.test.js`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 修改：`data/system/default_config.json`
- 修改：`guoba.support.js`
- 修改：`apps/jmDownload.js`
- 修改：`apps/vvShuo.js`
- 修改：`model/eduAuth.js`
- 修改：`model/autoTask.js`
- 修改：`model/utils.js`

- [ ] **步骤 1：编写失败的代理配置测试**

断言根配置只含一个 `proxy.url`，并包含 `proxy.autoUpdate`、`proxy.randomBackground`、`JMComic.proxy.enable`、`vvShuo.proxy.enable`、`eduAuth.proxy.enable`。断言启用功能时 dispatcher 使用根地址，关闭或地址为空时保持直连。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/proxy.test.js`

预期：FAIL，原因是 `model/proxy.js` 或默认配置字段不存在。

- [ ] **步骤 3：编写失败的 JMComic YAML 测试**

用带 `client.domain` 和插件配置的 YAML 验证：开启时写入 `client.postman.meta_data.proxies`；关闭时只删除 `proxies`；其他配置仍能解析为原值；无变化时不重写文件。

- [ ] **步骤 4：运行测试验证失败**

运行：`node --test test/jmOption.test.js`

预期：FAIL，原因是 `model/jmOption.js` 不存在。

- [ ] **步骤 5：实现最少代理与 YAML 同步代码**

`model/proxy.js` 导出 `getProxyDispatcher(pluginConfig, enabled, dependencies)` 和 `withProxy(init, pluginConfig, enabled, dependencies)`；按 URL 缓存 `ProxyAgent`。`model/jmOption.js` 使用 `yaml.parseDocument()`、`setIn()`、`deleteIn()` 和同目录临时文件原子替换。

- [ ] **步骤 6：接入现有全部网络出口**

VV 说、EDU 认证、自动更新和随机背景 fetch 使用 `withProxy()`；JMComic 每次执行命令前同步 YAML。代理开关开启但地址为空时由统一 helper 记录一次警告并直连。

- [ ] **步骤 7：验证并提交**

运行：`node --test test/proxy.test.js test/jmOption.test.js`、相关 ESLint、Prettier 和 `git diff --check`。

提交：`feat(代理): 添加全插件统一代理配置`

### 任务 3：AI 图片配置与消息解析

**文件：**

- 创建：`model/aiImageMessage.js`
- 创建：`test/aiImageConfig.test.js`
- 创建：`test/aiImageMessage.test.js`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 修改：`data/system/default_config.json`
- 修改：`guoba.support.js`
- 修改：`docs/superpowers/specs/2026-08-12-ai-image-provenance-design.md`
- 修改：`docs/superpowers/plans/2026-08-12-ai-image-provenance.md`

- [ ] **步骤 1：编写失败的配置测试**

断言 Node.js 要求为 22；`aiImage.proxy.enable` 存在；OpenAI/Hive 只有 `apiKeys` 数组，没有 `apiKey`；Sightengine 只有 `credentials` 数组，没有 `apiUser`、`apiSecret`；provider 内没有代理地址或代理开关。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/aiImageConfig.test.js`

预期：FAIL，原因是配置结构不符合新规格。

- [ ] **步骤 3：编写失败的消息解析测试**

覆盖 `ai图` 大小写、可选 `#`、当前消息图片优先、引用图片回退、图片段 URL 去重和无图片。

- [ ] **步骤 4：运行测试验证失败**

运行：`node --test test/aiImageMessage.test.js`

预期：FAIL，原因是消息解析模块不存在。

- [ ] **步骤 5：实现最少配置和解析代码**

升级 Node.js engine 并加入 C2PA 依赖；更新默认配置和锅巴 schema；实现 `isAiImageCommand()` 与 `extractImageUrls()`，不添加尚未完整工作的 app 入口。

- [ ] **步骤 6：验证并提交**

运行配置/消息测试、相关 ESLint、Prettier 和 `git diff --check`。

提交：`feat(AI图片): 添加识别配置与消息解析`

### 任务 4：AI 图片检测、代理和凭据轮换

**文件：**

- 创建：`apps/aiImage.js`
- 创建：`model/aiImage.js`
- 创建：`model/aiImageProviders.js`
- 创建：`test/aiImageInspect.test.js`
- 创建：`test/aiImageProviders.test.js`
- 创建：`test/aiImageSummary.test.js`
- 修改：`README.md`

- [ ] **步骤 1：编写失败的 provider 轮换测试**

OpenAI、Hive 使用 `apiKeys`；Sightengine 使用 `credentials`。验证每次请求轮换起点，401/403/429 自动尝试下一个，所有凭据失败后返回 `unavailable`，错误消息不包含凭据。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/aiImageProviders.test.js`

预期：FAIL，原因是 provider 模块不存在。

- [ ] **步骤 3：实现 provider 与汇总器**

实现 C2PA、OpenAI、Hive、Sightengine 适配和 `summarizeAiImageResults()`；Sightengine 凭据放入 multipart body；明确区分 `detected`、`not_detected`、`unavailable`、`error`。

- [ ] **步骤 4：编写失败的 AI 整体代理测试**

验证 `aiImage.proxy.enable=true` 时图片下载和三个外部 provider 都使用根级代理 dispatcher；关闭时全部直连；C2PA 不创建代理 dispatcher。

- [ ] **步骤 5：运行测试验证失败**

运行：`node --test test/aiImageInspect.test.js`

预期：FAIL，原因是下载与 provider 尚未接入统一代理。

- [ ] **步骤 6：实现下载、入口和代理传递**

实现带 SSRF 防护、逐跳重定向校验和流式大小限制的图片下载；`apps/aiImage.js` 传入根级配置；所有外部请求复用 `model/proxy.js`。

- [ ] **步骤 7：更新 README 并完整验证**

记录 API 申请入口、费用边界、多凭据格式、统一代理配置和证据限制。运行 `node --test test/*.test.js`、相关 ESLint、Prettier、`git diff --check`。

- [ ] **步骤 8：提交**

提交：`feat(AI图片): 实现来源检测与凭据轮换`

### 任务 5：历史与污染复核

**文件：**

- 只读检查全部版本控制文件

- [ ] **步骤 1：复核原子提交**

运行：`git log --oneline --decorate 55fdd19..HEAD` 和逐提交 `git show --stat`。

预期：恰好 3 个功能提交，每个提交职责与计划一致。

- [ ] **步骤 2：复核工作区污染**

运行：`git status --short`、`git diff --check`、`git ls-files --others --exclude-standard`。

预期：工作区干净；没有密钥、缓存、日志、临时 YAML 或生成文件被跟踪。

- [ ] **步骤 3：最终验证**

重新运行完整测试、相关 ESLint 和 Prettier。记录仓库级 lint 中与本次无关的历史问题，不修改无关文件。
