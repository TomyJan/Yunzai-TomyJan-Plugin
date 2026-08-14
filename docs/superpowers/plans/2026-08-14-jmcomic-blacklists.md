# JMComic 黑名单实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 JMComic 下载增加可独立启用的本子 ID 和作者名称黑名单，并通过官方 `jmv` 命令在下载前检查作者。

**架构：** 新建无 Yunzai 运行时依赖的 `model/jmBlacklist.js`，负责 ID 规范化、黑名单决策、`jmv` 输出解析和可注入命令执行器的作者查询。`apps/jmDownload.js` 只负责编排回复、日志、代理同步和下载流程，确保所有黑名单检查都发生在准备消息及缓存目录创建之前。

**技术栈：** Node.js 22、ES Modules、Node.js Test Runner、现有 `runCommand`、JMComic `jmv` CLI、锅巴 `GTags`。

---

## 文件结构

- 创建 `model/jmBlacklist.js`：封装黑名单配置判断、ID/作者规范化、`jmv` 解析和前置检查流程。
- 创建 `test/jmBlacklist.test.js`：覆盖纯函数、`jmv` 错误和按开关调用行为。
- 创建 `test/jmBlacklistConfig.test.js`：覆盖默认配置与锅巴字段、组件和帮助文案。
- 修改 `apps/jmDownload.js`：在下载资源创建前调用黑名单检查并回复明确原因。
- 修改 `data/system/default_config.json`：增加两类默认关闭的黑名单配置。
- 修改 `guoba.support.js`：在 JMComic 卡片增加两组开关和数组输入。
- 修改 `test/guobaCards.test.js`：更新 JMComic 卡片字段契约。
- 修改 `README.md`：说明配置、前置请求、失败关闭和最多 10 名作者限制。

### 任务 1：黑名单规则与 `jmv` 解析

**文件：**

- 创建：`test/jmBlacklist.test.js`
- 创建：`model/jmBlacklist.js`

- [ ] **步骤 1：编写 ID 和作者匹配的失败测试**

测试定义以下公共接口和行为：

```javascript
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkJmBlacklists,
  normalizeJmAlbumId,
  parseJmvAuthors,
} from '../model/jmBlacklist.js'

test('normalizes decimal JM album IDs without numeric precision loss', () => {
  assert.equal(normalizeJmAlbumId('000123'), '123')
  assert.equal(normalizeJmAlbumId(123), '123')
  assert.equal(normalizeJmAlbumId('000000'), '0')
  assert.equal(normalizeJmAlbumId('12x'), null)
})

test('parses all author names exposed by jmv', () => {
  const output = '  ✍️ 作者:  Alice, Bob, 陈某\n'
  assert.deepEqual(parseJmvAuthors(output), ['Alice', 'Bob', '陈某'])
  assert.deepEqual(parseJmvAuthors('  ✍️ 作者:  未知\n'), [])
})

test('checks album ID before author lookup', async () => {
  let authorLookupCount = 0
  const result = await checkJmBlacklists({
    albumId: '000123',
    albumIdBlacklist: { enable: true, ids: [123] },
    authorNameBlacklist: { enable: true, names: ['Alice'] },
    loadAuthors: async () => {
      authorLookupCount += 1
      return ['Alice']
    },
  })
  assert.deepEqual(result, { type: 'albumId', value: '123' })
  assert.equal(authorLookupCount, 0)
})

test('skips author lookup when the author blacklist is disabled', async () => {
  let authorLookupCount = 0
  const result = await checkJmBlacklists({
    albumId: '123',
    albumIdBlacklist: { enable: false, ids: ['123'] },
    authorNameBlacklist: { enable: false, names: ['Alice'] },
    loadAuthors: async () => {
      authorLookupCount += 1
      return ['Alice']
    },
  })
  assert.equal(result, null)
  assert.equal(authorLookupCount, 0)
})

test('matches trimmed author names case-insensitively', async () => {
  const result = await checkJmBlacklists({
    albumId: '123',
    albumIdBlacklist: { enable: false, ids: [] },
    authorNameBlacklist: { enable: true, names: [' alice '] },
    loadAuthors: async () => ['Alice', 'Bob'],
  })
  assert.deepEqual(result, { type: 'authorName', value: 'Alice' })
})
```

另加两个错误测试：作者行缺失时 `parseJmvAuthors` 抛出 `无法解析 jmv 作者字段`；作者黑名单启用且 `loadAuthors` 失败时，`checkJmBlacklists` 原样抛出错误，以便入口统一失败关闭。

- [ ] **步骤 2：运行测试并确认正确失败**

运行：

```bash
node --test test/jmBlacklist.test.js
```

预期：FAIL，错误为找不到 `model/jmBlacklist.js`，证明新接口尚未实现。

- [ ] **步骤 3：实现最少的黑名单模块**

`model/jmBlacklist.js` 导出以下函数：

```javascript
export function normalizeJmAlbumId(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  return text.replace(/^0+(?=\d)/, '')
}

function normalizeAuthorName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function parseJmvAuthors(output) {
  const line = String(output ?? '')
    .split(/\r?\n/)
    .find((item) => /作者\s*:/.test(item))
  if (!line) throw new Error('无法解析 jmv 作者字段')

  const value = line.slice(line.indexOf(':') + 1).trim()
  if (!value || value === '未知') return []
  return value
    .replace(/\s+\.\.\.等\d+个$/, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function checkJmBlacklists({
  albumId,
  albumIdBlacklist,
  authorNameBlacklist,
  loadAuthors,
}) {
  const normalizedId = normalizeJmAlbumId(albumId)
  if (albumIdBlacklist?.enable) {
    const blockedIds = new Set(
      (Array.isArray(albumIdBlacklist.ids) ? albumIdBlacklist.ids : [])
        .map(normalizeJmAlbumId)
        .filter(Boolean),
    )
    if (blockedIds.has(normalizedId)) {
      return { type: 'albumId', value: normalizedId }
    }
  }

  if (!authorNameBlacklist?.enable) return null
  const authors = await loadAuthors()
  const blockedAuthors = new Set(
    (Array.isArray(authorNameBlacklist.names) ? authorNameBlacklist.names : [])
      .map(normalizeAuthorName)
      .filter(Boolean),
  )
  const matched = authors.find((author) =>
    blockedAuthors.has(normalizeAuthorName(author)),
  )
  return matched ? { type: 'authorName', value: matched } : null
}
```

- [ ] **步骤 4：运行测试并确认通过**

运行：

```bash
node --test test/jmBlacklist.test.js
```

预期：全部 PASS，无警告。

- [ ] **步骤 5：提交核心规则**

```bash
git add model/jmBlacklist.js test/jmBlacklist.test.js
git commit -m "feat(JMComic): 添加黑名单匹配规则"
```

### 任务 2：`jmv` 作者查询与失败关闭

**文件：**

- 修改：`test/jmBlacklist.test.js`
- 修改：`model/jmBlacklist.js`

- [ ] **步骤 1：编写 `jmv` 查询的失败测试**

新增以下测试，命令执行器使用可注入函数，不启动真实 `jmv`：

```javascript
import { loadJmvAuthors } from '../model/jmBlacklist.js'

test('loads authors with jmv and the active option file', async () => {
  let command = ''
  const authors = await loadJmvAuthors({
    albumId: '123',
    optionPath: '/bot/data/JMComic/option.yml',
    execute: async (value) => {
      command = value
      return { output: '  ✍️ 作者:  Alice, Bob', err: '' }
    },
  })
  assert.equal(command, 'jmv 123 --option="/bot/data/JMComic/option.yml" --yes')
  assert.deepEqual(authors, ['Alice', 'Bob'])
})

test('fails closed when jmv has no output', async () => {
  await assert.rejects(
    loadJmvAuthors({
      albumId: '123',
      optionPath: '/bot/data/JMComic/option.yml',
      execute: async () => ({ output: '', err: 'jmv: command not found' }),
    }),
    /jmv 查询失败/,
  )
})
```

再覆盖 `execute` 抛出异常和输出缺少作者行两种情况，断言错误均向上抛出。

- [ ] **步骤 2：运行测试并确认正确失败**

运行：

```bash
node --test test/jmBlacklist.test.js
```

预期：FAIL，错误为 `loadJmvAuthors` 未导出。

- [ ] **步骤 3：实现 `jmv` 查询包装器**

在 `model/jmBlacklist.js` 中增加：

```javascript
export async function loadJmvAuthors({ albumId, optionPath, execute }) {
  const normalizedId = normalizeJmAlbumId(albumId)
  if (!normalizedId) throw new Error('无效的 JMComic ID')

  const result = await execute(
    `jmv ${normalizedId} --option="${optionPath}" --yes`,
  )
  if (!result?.output) {
    const detail = result?.err ? `: ${result.err}` : ''
    throw new Error(`jmv 查询失败${detail}`)
  }
  return parseJmvAuthors(result.output)
}
```

入口日志负责避免输出完整外部错误；该函数保留错误摘要供日志记录。

- [ ] **步骤 4：运行测试并确认通过**

运行：

```bash
node --test test/jmBlacklist.test.js
```

预期：全部 PASS。

- [ ] **步骤 5：提交作者查询包装器**

```bash
git add model/jmBlacklist.js test/jmBlacklist.test.js
git commit -m "feat(JMComic): 添加 jmv 作者前置查询"
```

### 任务 3：接入下载流程与配置界面

**文件：**

- 创建：`test/jmBlacklistConfig.test.js`
- 修改：`data/system/default_config.json`
- 修改：`guoba.support.js`
- 修改：`test/guobaCards.test.js`
- 修改：`apps/jmDownload.js`

- [ ] **步骤 1：编写默认配置和锅巴契约的失败测试**

`test/jmBlacklistConfig.test.js` 读取默认 JSON 和锅巴源码，断言：

```javascript
test('defines disabled JMComic blacklists by default', () => {
  assert.deepEqual(defaultConfig.JMComic.albumIdBlacklist, {
    enable: false,
    ids: [],
  })
  assert.deepEqual(defaultConfig.JMComic.authorNameBlacklist, {
    enable: false,
    names: [],
  })
})

test('uses editable Guoba tag arrays and documents the jmv cost', () => {
  for (const field of [
    'JMComic.albumIdBlacklist.ids',
    'JMComic.authorNameBlacklist.names',
  ]) {
    const start = guobaSource.indexOf(`field: '${field}'`)
    assert.notEqual(start, -1)
    assert.match(guobaSource.slice(start, start + 500), /component: 'GTags'/)
  }
  assert.match(guobaSource, /额外查询一次本子详情/)
  assert.match(guobaSource, /最多获取前 10 个作者/)
})
```

同时将 `test/guobaCards.test.js` 的 JMComic 期望字段更新为：

```javascript
'JMComic.albumIdBlacklist.enable',
'JMComic.albumIdBlacklist.ids',
'JMComic.authorNameBlacklist.enable',
'JMComic.authorNameBlacklist.names',
```

- [ ] **步骤 2：运行配置测试并确认正确失败**

运行：

```bash
node --test test/jmBlacklistConfig.test.js test/guobaCards.test.js
```

预期：FAIL，提示默认配置和锅巴字段缺失。

- [ ] **步骤 3：增加默认配置和锅巴字段**

在 `data/system/default_config.json` 的 `JMComic` 下增加两个对象。在 `guoba.support.js` 的 JMComic 卡片中增加 4 个字段：两个 `Switch` 和两个允许增删的 `GTags`。作者开关的 `helpMessage` 说明会额外查询详情并影响速度，作者数组的 `bottomHelpMessage` 说明 `jmv` 最多获取前 10 个作者。

- [ ] **步骤 4：将黑名单检查接入下载入口**

在 `apps/jmDownload.js` 导入：

```javascript
import {
  checkJmBlacklists,
  loadJmvAuthors,
  normalizeJmAlbumId,
} from '../model/jmBlacklist.js'
```

纯数字校验后使用 `normalizeJmAlbumId` 代替 `parseInt`。本子 ID 检查先于命令可用性检查。代理同步移动到准备消息和缓存目录创建之前，然后执行：

```javascript
try {
  const blocked = await checkJmBlacklists({
    albumId: id,
    albumIdBlacklist: pluginConfig.JMComic.albumIdBlacklist,
    authorNameBlacklist: pluginConfig.JMComic.authorNameBlacklist,
    loadAuthors: () =>
      loadJmvAuthors({
        albumId: id,
        optionPath,
        execute: runCommand,
      }),
  })

  if (blocked?.type === 'albumId') {
    tjLogger.info(`JMComic ID ${id} 命中本子 ID 黑名单`)
    await this.reply(`JMComic ID: ${id} 已被加入黑名单，禁止下载`, true)
    return
  }
  if (blocked?.type === 'authorName') {
    tjLogger.info(`JMComic ID ${id} 命中作者名称黑名单: ${blocked.value}`)
    await this.reply(
      `JMComic 作者「${blocked.value}」已被加入黑名单，禁止下载`,
      true,
    )
    return
  }
} catch (error) {
  tjLogger.warn(`JMComic ${id} 作者前置检查失败: ${error.message}`)
  await this.reply(
    'JMComic 作者前置检查失败，已停止下载，请检查 jmv 是否可用',
    true,
  )
  return
}
```

由于 `checkJmBlacklists` 仅在作者开关打开时调用 `loadAuthors`，作者黑名单关闭时不会执行 `jmv`。所有命中和错误分支都发生在准备消息、归档复制和缓存目录创建之前。

- [ ] **步骤 5：运行聚焦测试并确认通过**

运行：

```bash
node --test test/jmBlacklist.test.js test/jmBlacklistConfig.test.js test/guobaCards.test.js
```

预期：全部 PASS。

- [ ] **步骤 6：提交下载流程和配置界面**

```bash
git add apps/jmDownload.js data/system/default_config.json guoba.support.js test/guobaCards.test.js test/jmBlacklistConfig.test.js
git commit -m "feat(JMComic): 接入可配置下载黑名单"
```

### 任务 4：README 与发布验证

**文件：**

- 修改：`README.md`

- [ ] **步骤 1：补充配置与限制说明**

在 README 的 JMComic 配置示例中加入两个黑名单对象，并在功能介绍中说明：

- 本子 ID 和作者名称黑名单可独立启用；
- 作者名称黑名单启用后，每次下载前会调用 `jmv` 增加一次网络查询；
- `jmv` 最多输出前 10 个作者；
- 作者前置检查失败时插件会停止下载；
- 作者名称使用完整匹配，英文不区分大小写。

- [ ] **步骤 2：运行格式化检查和完整测试**

依次运行：

```bash
pnpm exec prettier --write apps/jmDownload.js model/jmBlacklist.js guoba.support.js test/jmBlacklist.test.js test/jmBlacklistConfig.test.js test/guobaCards.test.js README.md docs/superpowers/plans/2026-08-14-jmcomic-blacklists.md
pnpm run format:check
pnpm run lint
pnpm test
git diff --check
```

预期：Prettier、ESLint 和全部 Node.js 测试通过；`git diff --check` 无输出。

- [ ] **步骤 3：审查发布风险**

确认 `git diff --stat` 仅包含计划内文件；确认未新增 `.py`、依赖或锁文件；确认作者开关关闭时 `jmv` 不可达；确认所有黑名单分支都位于缓存目录创建之前。

- [ ] **步骤 4：提交 README**

```bash
git add README.md
git commit -m "docs(JMComic): 说明黑名单配置与限制"
```
