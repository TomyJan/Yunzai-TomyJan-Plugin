# GitHub Copilot Instructions - Yunzai-TomyJan-Plugin

## 项目简介

这是一个 [Yunzai-Bot](https://github.com/yoimiya-kokomi/Miao-Yunzai) 插件项目，使用 JavaScript (ES Module) 开发。

## AI 工作准则

1. **了解项目结构** - 开始前先阅读 README.md 了解功能和配置
2. **遵循代码风格** - 保持与现有代码一致的风格
3. **完成后验证** - 运行 `pnpm lint` 检查代码规范

## 项目结构

```
apps/           → 插件功能入口 (继承 plugin 类)
model/          → 业务逻辑和工具函数
components/     → 公共组件 (logger, config)
data/system/    → 系统常量和默认配置
config/         → 用户配置 (config.json)
resources/      → 静态资源 (图片、字体、HTML模板)
```

## 开发规范

### 新增功能

1. 在 `apps/` 创建功能入口文件，继承 `plugin` 类
2. 在 `model/` 编写业务逻辑
3. 需要配置项时，更新 `data/system/default_config.json` 和 `guoba.support.js`

### 代码风格

- **ES Module**: 使用 `import/export`
- **Prettier**: 单引号、无分号
- **函数注释**: 使用 JSDoc 格式

```javascript
/**
 * 功能说明
 * @param {number} param 参数说明
 * @returns {Promise<void>}
 */
export async function example(param) {
  // ...
}
```

### 日志使用

```javascript
import tjLogger from '../components/logger.js'

tjLogger.info('信息日志')
tjLogger.debug('调试日志')
tjLogger.warn('警告日志')
tjLogger.error('错误日志')
```

### 配置读取

```javascript
import config from '../components/config.js'

const cfg = config.getConfig()
if (cfg.featureName.enable) {
  // 功能逻辑
}
```

### 常量引用

```javascript
import {
  pluginPath,
  dataPath,
  resPath,
  pluginVer,
} from '../data/system/pluginConstants.js'
```

## 常用命令

```bash
pnpm install      # 安装依赖
pnpm format       # Prettier 格式化
pnpm lint         # ESLint 检查
pnpm lint:fix     # ESLint 自动修复
pnpm changelog    # 生成更新日志
```

## 注意事项

- 插件运行在 Yunzai-Bot 环境中，全局 `logger` 变量可用
- 消息回复使用 `this.reply('消息内容', true)` (第二个参数为是否引用回复)
- 配置修改后需要更新 `guoba.support.js` 以支持锅巴插件配置界面
