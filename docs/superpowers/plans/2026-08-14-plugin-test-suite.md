# 全插件测试整顿实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 清理低价值测试、补足插件历史核心业务覆盖、建立可信的核心覆盖率门槛，并让 CI 同时覆盖 `master` 和 `dev`。

**架构：** 将 EDU、VV 说、JMComic 输出和 HTTP 路径中的高风险规则提取为无副作用的 ES Modules，由应用入口复用。配置与锅巴通过结构化导出做契约测试；Node.js 22 原生覆盖率只统计明确列出的核心模块。

**技术栈：** Node.js 22、ES Modules、Node.js Test Runner、Node.js 原生覆盖率、GitHub Actions、YAML。

---

## 文件结构

- 创建 `model/eduAuthRules.js`：EDU 日期、用户状态、宽限期、无效原因、任务结果和报告纯逻辑。
- 创建 `test/eduAuthRules.test.js`：覆盖 EDU 状态边界、任务码和报告格式。
- 创建 `model/vvShuo.js`：VV 说命令参数与响应标准化。
- 创建 `test/vvShuo.test.js`：覆盖普通/在线/增强模式及异常响应。
- 创建 `model/jmDownloadResult.js`：JMComic 命令输出分类和错误消息提取。
- 创建 `test/jmDownloadResult.test.js`：覆盖成功、空输出、已知异常和未知输出。
- 创建 `model/httpPath.js`：静态文件安全解析与 MIME 类型映射。
- 创建 `test/httpPath.test.js`：覆盖目录穿越、相似前缀、URL 编码和 MIME 类型。
- 修改 `model/eduAuth.js`、`apps/vvShuo.js`、`apps/jmDownload.js`、`model/httpServer.js`：复用纯逻辑模块。
- 修改 `guoba.support.js`：导出无副作用的 schema 构造函数。
- 修改 `test/aiImageConfig.test.js`、`test/guobaCards.test.js`、`test/jmBlacklistConfig.test.js`：改用结构化契约。
- 修改 `test/jmBlacklist.test.js`：删除重复用例。
- 修改 `package.json`、`.github/workflows/check_code.yml`、`test/releaseConfig.test.js`：增加核心覆盖率并覆盖 `dev`。

### 任务 1：测试基础设施与 CI 契约

**文件：**

- 修改：`test/releaseConfig.test.js`
- 修改：`package.json`
- 修改：`.github/workflows/check_code.yml`

- [ ] **步骤 1：先修改 CI 契约测试**

断言 `push` 和 `pull_request` 分支均为 `['master', 'dev']`，`package.json` 存在 `test:coverage`，Linux 测试步骤调用该脚本，Windows 仍调用 `pnpm test`。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/releaseConfig.test.js`

预期：FAIL，缺少 `dev` 分支和 `test:coverage` 脚本。

- [ ] **步骤 3：补充脚本与工作流**

`test:coverage` 使用 `node --test --experimental-test-coverage`，为核心 `model` 模块重复传入 `--test-coverage-include`，并设置 `--test-coverage-lines=90`、`--test-coverage-branches=80`、`--test-coverage-functions=90`。工作流测试矩阵按操作系统选择普通测试或覆盖率测试。

- [ ] **步骤 4：验证并签名提交**

运行：`node --test test/releaseConfig.test.js`

提交：`ci(测试): 覆盖 dev 并增加核心覆盖率门槛`

### 任务 2：EDU 核心规则

**文件：**

- 创建：`test/eduAuthRules.test.js`
- 创建：`model/eduAuthRules.js`
- 修改：`model/eduAuth.js`

- [ ] **步骤 1：编写失败测试**

测试固定 `now` 下永久有效、未到期、宽限次数与天数、过期、待审核、停用、封禁和未知状态；覆盖无效原因、成功/失败/处理中任务码，以及空结果和分类统计的报告。

期望接口：

```javascript
import {
  formatDateUTC8,
  formatUserStatusReport,
  getGracePeriodInfo,
  getInvalidReason,
  getUserStatus,
  isUserValid,
  resolveTaskResult,
} from '../model/eduAuthRules.js'
```

所有依赖当前时间的函数接受可选 `now = Date.now()`，生产调用无需修改参数。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/eduAuthRules.test.js`

预期：FAIL，找不到 `model/eduAuthRules.js`。

- [ ] **步骤 3：移动最少实现并保持兼容导出**

把对应实现移动到 `model/eduAuthRules.js`；`model/eduAuth.js` 导入并重新导出同名函数，网络请求、缓存和轮询继续保留在原文件。

- [ ] **步骤 4：验证并签名提交**

运行：`node --test test/eduAuthRules.test.js`

提交：`test(EDU): 覆盖认证状态与任务规则`

### 任务 3：VV 说请求规则

**文件：**

- 创建：`test/vvShuo.test.js`
- 创建：`model/vvShuo.js`
- 修改：`apps/vvShuo.js`

- [ ] **步骤 1：编写失败测试**

定义 `parseVvShuoRequest(message)` 返回 `{ content, enhanced, online }`，准确识别现有命令别名而不删除正文中的普通字符；定义 `normalizeVvShuoResponse(payload)` 返回可回复文本，并拒绝空值或异常结构。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/vvShuo.test.js`

预期：FAIL，找不到 `model/vvShuo.js`。

- [ ] **步骤 3：实现并接入入口**

入口继续使用现有 API、代理和回复文案，仅把命令清洗和响应取值改为调用纯函数。导出共享命令正则供规则注册和测试复用。

- [ ] **步骤 4：验证并签名提交**

运行：`node --test test/vvShuo.test.js`

提交：`test(VV说): 覆盖命令解析与响应处理`

### 任务 4：JMComic 下载结果规则

**文件：**

- 创建：`test/jmDownloadResult.test.js`
- 创建：`model/jmDownloadResult.js`
- 修改：`apps/jmDownload.js`
- 修改：`test/jmBlacklist.test.js`
- 修改：`test/jmBlacklistConfig.test.js`

- [ ] **步骤 1：编写失败测试并删除精确重复用例**

定义 `classifyJmDownloadResult(result)`，覆盖无输出、下载完成、JM 异常、不可见本子和未知输出；已知异常提取 JSON `errorMsg` 或纯文本，未知输出只返回分类，不复制未脱敏日志。删除重复的作者字段缺失测试和依赖入口源码调用顺序的断言。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/jmDownloadResult.test.js test/jmBlacklist.test.js test/jmBlacklistConfig.test.js`

预期：FAIL，找不到结果解析模块。

- [ ] **步骤 3：实现并接入下载入口**

应用入口根据 `{ type, message }` 执行清理、回复或后续转换；保持当前用户文案和失败分支语义。

- [ ] **步骤 4：验证并签名提交**

运行：`node --test test/jmDownloadResult.test.js test/jmBlacklist.test.js test/jmBlacklistConfig.test.js`

提交：`test(JMComic): 覆盖下载结果并清理重复测试`

### 任务 5：HTTP 路径安全规则

**文件：**

- 创建：`test/httpPath.test.js`
- 创建：`model/httpPath.js`
- 修改：`model/httpServer.js`

- [ ] **步骤 1：编写失败测试**

定义 `resolvePublicFile(rootDir, requestUrl)`：忽略查询串、解码 URL、将 `/` 映射到 `index.html`，拒绝 `..`、编码穿越、绝对路径和与根目录同前缀的旁路目录；定义 `getContentType(filePath)` 覆盖现有扩展名和默认二进制类型。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/httpPath.test.js`

预期：FAIL，找不到 `model/httpPath.js`。

- [ ] **步骤 3：实现并接入 HTTP 服务**

使用 `path.resolve` 与 `path.relative` 做目录边界判断；解析失败或越界返回 `null`，HTTP 服务对应回复 403，其他文件传输流程保持不变。

- [ ] **步骤 4：验证并签名提交**

运行：`node --test test/httpPath.test.js`

提交：`test(HTTP服务): 覆盖静态文件路径安全规则`

### 任务 6：锅巴契约与旧测试清理

**文件：**

- 修改：`guoba.support.js`
- 修改：`test/aiImageConfig.test.js`
- 修改：`test/guobaCards.test.js`
- 修改：`test/jmBlacklistConfig.test.js`

- [ ] **步骤 1：先把测试改为结构化接口**

从 `guoba.support.js` 导出的无副作用 schema 构造函数读取卡片和字段，断言每项字段唯一、数组凭据使用可增删 `GTags`、每个功能位于独立卡片、无独立卡片功能的代理开关位于代理卡片。删除源码窗口、正则和字段先后顺序断言。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/aiImageConfig.test.js test/guobaCards.test.js test/jmBlacklistConfig.test.js`

预期：FAIL，schema 构造函数尚未导出。

- [ ] **步骤 3：提取 schema 构造函数**

函数只返回 schema 数组，不访问 Yunzai、配置文件或日志；`supportGuoba()` 调用该函数组装现有返回值，界面行为不变。

- [ ] **步骤 4：验证并签名提交**

运行上述聚焦测试。

提交：`test(锅巴配置): 改用结构化配置契约`

### 任务 7：全量验证和发布审查

**文件：**

- 可能修改：`package.json` 中核心覆盖清单及本计划内测试文件

- [ ] **步骤 1：校准覆盖清单**

运行 `pnpm test:coverage`，只在核心模块存在未测试的实际分支时补行为用例；不得通过移除高风险模块或添加忽略注释绕过门槛。

- [ ] **步骤 2：执行完整发布检查**

依次运行：

```bash
pnpm test
pnpm test:coverage
pnpm test:c2pa
pnpm lint
pnpm format:check
git diff --check
```

预期：所有命令退出码为 0，测试无失败，覆盖率达到行 90%、分支 80%、函数 90%。

- [ ] **步骤 3：进行代码审查和提交审计**

检查行为兼容性、测试价值、敏感信息、跨平台路径、CI 条件、所有新增提交 GPG 签名和工作树状态。修复 Critical/Important 问题后重新执行完整发布检查。

- [ ] **步骤 4：提交最终清理**

如产生独立的测试清理或覆盖清单调整，提交：`test(全插件): 清理低价值测试并校准覆盖门槛`。
