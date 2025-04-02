<div align=center>

[![State-of-the-art Shitcode](https://img.shields.io/static/v1?label=State-of-the-art&message=Shitcode&color=7B5804)](https://github.com/TomyJan/Yunzai-TomyJan-Plugin)

# Yunzai-TomyJan-Plugin

</div>

[Yunzai-TomyJan-Plugin (TJ插件)](https://github.com/TomyJan/Yunzai-TomyJan-Plugin) 是 [Yunzai-Bot](https://github.com/yoimiya-kokomi/Miao-Yunzai) 的 一个 TomyJan 自用插件, 具体介绍见 [功能介绍](#功能介绍)

## 安装与维护

项目只在 GitHub 提供功能交流等, 不通过任何渠道提供技术支持

安装前请先 [前往GitHub](https://github.com/TomyJan/Yunzai-TomyJan-Plugin/) 点一下右上角的 Star, 这对我非常重要, 谢谢喵~

### 安装插件

本插件*不兼容*也*不会兼容* trss 这种插后门的东西，执意要使用此框架请另寻替代

插件更新强依赖 Git, 建议通过 Git 安装

#### 通过 Git 安装

在 Yunzai 根目录运行命令拉取插件:
```shell
git clone https://github.com/TomyJan/Yunzai-TomyJan-Plugin.git ./plugins/Yunzai-TomyJan-Plugin/
```

#### 自行下载安装

下载插件包, 解压至 Yunzai `./plugins` 目录内并重命名文件夹为 `Yunzai-TomyJan-Plugin`

### 安装依赖

```shell
pnpm install
```

外部依赖:

`JMComic 下载` 功能依赖 [`hect0x7/JMComic-Crawler-Python`](https://github.com/hect0x7/JMComic-Crawler-Python), 请先前往此项目按照说明在系统全局安装此工具:

```shell
pip install jmcomic -U --break-system-packages
```

安装问题请自行解决, 不提供任何支持

### 更新插件

[更新日志](/CHANGELOG.md)

如通过 Git 安装, 在 Yunzai 根目录运行以下命令即可

```shell
git -C ./plugins/Yunzai-TomyJan-Plugin/ pull
```

如为手动安装, 需要先备份插件 [数据目录](#数据目录) , 删除旧插件并解压新的插件后, 再将插件 [数据目录](#数据目录) 恢复进去, 即可完成更新

### 数据目录

`./config` 为插件配置目录

`./data` 为插件用户数据目录, 若你开启了 `JMComic` 的存档功能, 则需要备份 `./data/JMComic/archive` 目录, 这是你的存档数据.
其他的, `./data/system` 为插件系统数据, `./data/JMComic` 为 `JMComic` 功能的系统和缓存数据, `./data/httpServer` 为 插件内置服务器的系统和缓存数据, 不用备份

### 插件配置

建议通过 [锅巴插件](https://gitee.com/guoba-yunzai/guoba-plugin) 进行配置. 当然, 你也可以自己配置, 默认配置文件位置 `./data/system/default_config.json`, 配置文件位置 `./config/config.json`, 配置项默认值及其作用:

```json
// 此处的 json 可能忘记更新, 如果和实际的配置文件字段不同, 请及时反馈
{
  "logger": { // 插件的日志器配置
    "logLevel": "info", // 日志等级, 可选值: trace, debug, info, warn, error, fatal
    "saveToFile": false // 是否保存日志到文件
  },
    "JMComic": { // JMComic 功能配置
    "enable": true, // 是否启用 JMComic 功能
    "pdfPassword": "", // PDF 密码, 为空则不加密, 如果同时开启下方归档 PDF 功能, 请请确保设置的密码没有不可用于文件名的字符
    "sendPdfPassword": false, // 是否发送 PDF 密码, 仅在 `pdfPassword` 不为空时生效
    "sendFilePolicy": 1, // 发送文件策略, 0=只发文件, 1=优先文件, 2=只发链接
    "archiveDownloadedImg": false, // 是否归档下载的图片到 `./data/JMComic/archive/download/`, 若开启, 归档将同时将用作下载加速
    "archiveConvertedPdf": false // 是否归档转换后的 PDF 到 `./data/JMComic/archive/convert/`, 若为加密 PDF 则文件名会加上密码, 请确保设置的密码没有不可用于文件名的字符
  },
  "httpServer": { // 插件内置 HTTP 服务器配置
    "enable": false, // 是否启用 HTTP 服务器, 默认关闭, 建议手动启用并修改相关配置
    "listenPort": 5252, // 监听端口, 默认 5252
    "accessUrl": "http://127.0.0.1:5252/" // 访问 URL, 默认 http://127.0.0.1:5252/
  },
  "useRandomBgInCard": true, // 卡片是否使用随机背景图
  "attemptSendNonFriend": true, // 即使非好友也尝试推送消息
  "botQQ": 0 // 机器人 QQ 号, 使用第三方适配器或者其他多账号框架时可能需要配置
}
```

## 功能介绍

插件帮助信息 `#TJ帮助` `tjhelp` , 所有指令的 `#` 前缀均可省略

### JMComic 下载

- `#jm 1112863` 下载 JMComic 漫画并转换为 PDF 发送, 发送失败可选临时上传到插件内置 HTTP 服务器供用户下载
  注意大概由于 ICQQ 协议问题, 文件有相当大的概率发送失败, 建议配置启用插件内置 HTTP 服务器作为备用方案

## 关于

### 免责声明

- 功能仅限内部交流与小范围使用，请勿将 Yunzai-TomyJan-Plugin 及其组件和衍生项目用于任何以盈利为目的的场景
- 图片与其他素材均来自于网络，仅供交流学习使用，如有侵权请联系处理

### 贡献/帮助

有 bug? 要新功能? [提交 Issue](https://github.com/TomyJan/Yunzai-TomyJan-Plugin/issues/new/choose)

帮助我开发? [提交 PR](https://github.com/TomyJan/Yunzai-TomyJan-Plugin/compare)

插件有帮到你? [给我打赏](https://donate.tomys.top)

### 一起玩

[TG](https://t.me/TomyJan) | [Q 闲聊群](https://qun.tomys.top)

### 链接

- [yoimiya-kokomi/Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai)
- [TomyJan/Yunzai-Kuro-Plugin](https://github.com/TomyJan/Yunzai-Kuro-Plugin)

### 致谢

- [hect0x7/JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python)
