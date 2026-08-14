# 项目协作指南

## 适用范围

- 本文件适用于仓库根目录及全部子目录。若子目录以后增加更具体的 `AGENTS.md`，以更具体的规则为准。
- 本项目是面向 Yunzai v3 的 ESM 插件，生产环境通常位于 `plugins/Yunzai-TomyJan-Plugin`。修改路径处理时须同时考虑仓库独立运行和插件目录运行两种场景。
- 保持改动聚焦。不得覆盖或回退用户已有改动，也不要顺手重构无关代码。

## 理解代码

- 仓库存在 `.codegraph/` 时，定位符号、调用链或模块职责应先运行 `codegraph explore "<问题或符号>"`，再按需使用 `rg` 和直接读取文件。
- 开始工作前检查 `git status --short --branch`，确认当前分支和未提交改动。
- `index.js` 会动态加载 `apps/*.js`，并初始化定时任务。新增命令入口应放在 `apps/`，避免在入口模块顶层执行不必要的重操作。

## 目录职责

- `apps/`：Yunzai 插件类、命令匹配、事件处理和回复编排。将可独立验证的解析、决策和格式化逻辑下沉到 `model/`。
- `model/`：业务逻辑、外部服务适配器和尽量无副作用的辅助模块。新增纯逻辑时同时增加 `test/` 下的单元测试。
- `components/`：配置、日志等共享基础设施。日志使用 `components/logger.js`，不要依赖未注入的全局日志对象。
- `data/system/default_config.json`：默认配置的唯一基线；`data/system/pluginConstants.js`：插件路径和元数据常量。
- `model/guobaSchemas.js`：锅巴配置卡片和字段 schema；`guoba.support.js`：锅巴运行时适配、配置展开、规范化和保存。
- `test/`：基于 `node:test` 的常规测试；`native-tests/`：需要本机原生绑定的独立冒烟测试。
- `resources/`：帮助菜单、卡片和静态资源。新增用户命令时检查帮助菜单是否也需要更新。

## 运行环境与风格

- 使用 Node.js 22 或更高版本；包管理器以 `packageManager` 声明的 `pnpm@10.25.0` 为准。
- 使用 ES Modules、单引号、无分号和 2 空格缩进。提交前由 Prettier 和 ESLint 校验 JavaScript。
- 优先使用 `node:` 前缀导入 Node.js 内置模块。路径处理使用 `node:path`，兼顾 Windows 和 Linux。
- 注释说明原因、边界或兼容约束，不复述代码本身。
- 不要轻易修改 `package.json` 顶部标记为警告的元数据；除非任务明确要求发布，否则不要调整版本号或 `CHANGELOG.md`。

## 配置与锅巴契约

新增、删除或重命名配置项时，至少同步检查：

1. `data/system/default_config.json` 中的默认值。
2. `model/guobaSchemas.js` 中的字段、卡片和帮助文案。
3. `guoba.support.js` 中是否需要解析、序列化或迁移。
4. `test/guobaCards.test.js` 及对应功能的配置契约测试。
5. `README.md` 中面向用户的配置说明。

- 配置合并必须保留用户已有值；迁移函数应可重复执行且保持向后兼容。
- 数组输入使用锅巴 `GTags`。结构化凭据须在界面字符串与运行时对象之间显式解析和序列化，不要依赖隐式类型转换。
- 多 API Key 使用数组字段和轮换逻辑，不再引入单数 `apiKey` 兼容字段。
- 所有外部网络功能共用 `proxy.url`，每个功能独立决定是否启用代理。已有功能卡片时将开关放在该卡片；没有独立配置卡片时放在“代理设置”卡片。
- `config/config.json` 是运行时用户配置，已被忽略，不得提交。默认配置只能使用空值或无效占位符，不得写入真实密钥、Cookie、Token、代理凭据或用户数据。

## 功能边界

### AI 图片识别

- 保持“带图片发送 `ai图`”和“引用图片回复 `ai图`”两种入口可用，命令匹配不区分大小写。
- 启用的检测渠道应全部执行；提供商之间不是主备关系。凭据轮换只用于同一提供商内部的可重试鉴权或限流错误。
- C2PA 使用 `@contentauth/c2pa-node` 在本地验证，不额外引入外部二进制；安装或升级后用 `pnpm test:c2pa` 验证原生绑定。
- `aiImage.proxy.enable` 只控制 OpenAI、Hive、Sightengine API；图片下载（含重定向）和本地 C2PA 始终直连。
- 外部渠道必须有超时、文件大小限制、代理支持、响应规范化和清晰的失败状态。日志可记录渠道、耗时、HTTP 状态和轮换次数，但不得输出凭据或完整敏感响应。
- 单元测试使用注入的 `fetch`、reader 或工厂，不调用真实 OpenAI、Hive、Sightengine 等服务。

### JMComic

- 继续使用现有 `jmv` 调用链，不新增 Python 包依赖或其他外部二进制依赖，除非任务明确要求并补充安装与失败说明。
- JMComic 代理通过结构化 YAML API 同步到 `data/JMComic/option.yml`，保留未知字段并使用临时文件原子替换；关闭代理时只删除插件管理的 `proxies` 字段。
- 本子 ID 黑名单和作者名称黑名单保持独立开关与数组。仅在作者名称黑名单启用时执行前置详情查询，并只判断 `jmv` 可见的前 10 个作者。
- 执行外部命令时处理 Windows 编码和失败退出，并对命令、错误、PDF 密码及 URL 中的敏感参数脱敏。

### HTTP 与 EDU

- HTTP 静态文件访问必须经过 `model/httpPath.js` 的路径解析和真实路径校验，同时防止目录穿越、绝对路径、驱动器路径、无效编码和符号链接越界。
- EDU 的管理操作必须先校验管理群权限。群成员踢出等有副作用的动作不得在测试中触发真实 Bot 或网络调用。
- 外部请求和 Bot 调用要保留用户可理解的错误回复，并在日志中留下足够定位信息；不得因单项失败泄露密钥或导致整个插件加载失败。

## 测试与验证

- 测试使用 `node:test` 和 `node:assert/strict`，保持确定性，不依赖真实网络、真实账号、当前时间或本机已有缓存。
- 修复缺陷时先添加能复现问题的测试；新增行为同时覆盖成功、无配置、边界值和失败路径。
- 为了避免加载 Yunzai 全局对象或启动副作用，优先测试从 `apps/` 提取到 `model/` 的纯逻辑。
- 核心模块覆盖率门槛为行 90%、分支 80%、函数 90%；需要扩展核心范围时同步更新 `package.json` 和 `test/releaseConfig.test.js`。

提交前按改动范围执行：

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm test:coverage
pnpm test:c2pa
git diff --check
```

- 仅改 Markdown 时仍须执行 `git diff --check`；`format:check` 当前只覆盖 JavaScript。
- CI 在 `master` 和 `dev` 的 push 与 pull request 上运行，并在 Ubuntu、Windows 验证测试。不要用修改 CI、跳过测试或降低门槛来掩盖失败。

## 提交要求

- 保持一次提交只解决一个主题，提交信息使用中文 Conventional Commits，例如 `fix(AI图片): 修复引用图片解析`。
- 提交必须带 GPG 签名。提交后用 `git log -1 --format="%h %G? %GS %s"` 确认签名状态为 `G`。
- 除非用户明确要求，不创建新分支、不改写已有提交、不推送远端。
- 提交前后检查工作树，确保未包含 `config/`、日志、缓存、归档、下载内容、密钥或其他运行时数据。
