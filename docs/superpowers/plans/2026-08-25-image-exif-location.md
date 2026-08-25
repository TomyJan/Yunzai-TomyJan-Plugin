# 图片 EXIF 定位自动回复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 自动提取获准图片消息的 EXIF GPS，反向解析中文位置并使用安全称呼回复。

**架构：** 将 EXIF/地理编码、触发/称呼策略和 Yunzai 编排拆为三个模块。复用现有安全图片下载器，所有外部依赖可注入，配置默认关闭且群聊使用白名单。

**技术栈：** Node.js 22 ESM、Yunzai v3、`exifr`、Undici、`node:test`、锅巴 schema。

---

## 文件结构

- 创建 `model/imageExifLocation.js`：GPS 提取、地址规范化、Nominatim 兼容客户端、有限缓存/节流/背压、消息格式化。
- 创建 `model/imageExifPolicy.js`：事件触发策略和显示名称选择。
- 创建 `apps/imageExif.js`：自动图片事件编排。
- 创建 `test/imageExifLocation.test.js`、`test/imageExifPolicy.test.js`、`test/imageExifApp.test.js`：纯逻辑与轻量应用契约测试。
- 修改 `data/system/default_config.json`、`model/guobaSchemas.js`、`test/guobaCards.test.js`、`README.md`：配置和文档。
- 修改 `package.json`、`pnpm-lock.yaml`、`test/releaseConfig.test.js`：依赖和核心覆盖率范围。

### 任务 1：EXIF 与地点核心

- [ ] **步骤 1：编写失败测试**

在 `test/imageExifLocation.test.js` 定义期望 API：

```js
const gps = await extractGps(Buffer.from('image'), {
  gpsReader: async () => ({ latitude: 31.03, longitude: 121.23 }),
})
assert.deepEqual(gps, { latitude: 31.03, longitude: 121.23 })
assert.equal(
  formatLocation({ state: '上海市', city: '上海市', city_district: '松江区', town: '泗泾镇' }),
  '上海市松江区泗泾镇',
)
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/imageExifLocation.test.js`

预期：FAIL，模块 `model/imageExifLocation.js` 不存在。

- [ ] **步骤 3：最少实现并安装解析器**

运行：`pnpm add exifr`

实现 `extractGps`、`formatLocation`、`formatExifReply`；严格校验有限数值及纬度 `[-90, 90]`、经度 `[-180, 180]`，地址按层级去重。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/imageExifLocation.test.js`

预期：全部 PASS。

### 任务 2：反向地理编码客户端

- [ ] **步骤 1：扩展失败测试**

用注入的 `fetchImpl`、`sleep` 和 `now` 验证 HTTPS endpoint、`format=jsonv2`、`addressdetails=1`、`accept-language=zh-CN`、User-Agent、超时、代理、非 2xx、五位小数缓存和一秒节流。

- [ ] **步骤 2：运行测试验证正确失败**

运行：`node --test test/imageExifLocation.test.js`

预期：FAIL，`createReverseGeocoder` 尚未导出。

- [ ] **步骤 3：实现最少客户端**

客户端返回规范化的地址对象或 `undefined`；缓存 Promise 防止并发重复；通过 `withProxy` 接入统一代理；仅接受 HTTPS endpoint。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/imageExifLocation.test.js`

预期：全部 PASS。

### 任务 3：触发策略与称呼

- [ ] **步骤 1：编写失败测试**

在 `test/imageExifPolicy.test.js` 覆盖：默认只允许私聊；关闭私聊时拒绝；群号在数字/字符串白名单中允许；群名片优先昵称；控制字符被折叠；最长 32 字；空名称回退“朋友”。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/imageExifPolicy.test.js`

预期：FAIL，模块不存在。

- [ ] **步骤 3：实现最少策略**

导出 `shouldInspectImageEvent(event, config)` 与 `getSenderDisplayName(event)`，不访问全局 Bot。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/imageExifPolicy.test.js`

预期：全部 PASS。

### 任务 4：Yunzai 应用编排

- [ ] **步骤 1：编写失败契约测试**

在 `test/imageExifApp.test.js` 用源码契约和可注入编排函数验证：应用监听 `message`、规则匹配任意消息、先检查配置/场景/图片、只处理第一张图、没有地点不回复、成功时调用 `reply`。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/imageExifApp.test.js`

预期：FAIL，应用模块不存在。

- [ ] **步骤 3：实现应用与编排函数**

创建 `apps/imageExif.js`。异常只写 `[图片EXIF]` 阶段日志，不把 URL、坐标、地点或昵称写入日志；处理完成返回 `true`，跳过返回 `false`。

- [ ] **步骤 4：运行相关测试**

运行：`node --test test/imageExifApp.test.js test/imageExifLocation.test.js test/imageExifPolicy.test.js`

预期：全部 PASS。

### 任务 5：配置与发布契约

- [ ] **步骤 1：先修改失败的契约测试**

更新 `test/guobaCards.test.js`，要求“图片 EXIF 定位设置”卡片恰好包含 `imageExif.enable`、`allowPrivate`、`allowedGroups`、`honorific`、`timeoutMs`、`maxFileSize`、`geocodingEndpoint`、`attribution`、`proxy.enable`。更新 `test/releaseConfig.test.js`，要求覆盖率脚本包含三个新 model。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/guobaCards.test.js test/releaseConfig.test.js`

预期：卡片和覆盖范围断言 FAIL。

- [ ] **步骤 3：同步配置与文档**

修改默认配置、锅巴 schema、README 配置示例和功能说明；`allowedGroups` 使用 `GTags`，endpoint 与署名使用普通输入框，功能及代理均为开关。

- [ ] **步骤 4：运行契约测试验证通过**

运行：`node --test test/guobaCards.test.js test/releaseConfig.test.js`

预期：全部 PASS。

### 任务 6：完整验证

- [ ] 运行 `pnpm format:check`。
- [ ] 运行 `pnpm lint`。
- [ ] 运行 `pnpm test`。
- [ ] 运行 `pnpm test:coverage`，确认核心行 90%、分支 80%、函数 90%。
- [ ] 运行 `pnpm test:c2pa`。
- [ ] 运行 `git diff --check`。
- [ ] 检查 `git status --short` 与 `git diff --stat`，确认没有运行时配置、密钥、缓存或下载内容。
