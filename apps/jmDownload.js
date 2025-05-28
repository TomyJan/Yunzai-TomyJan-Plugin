import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import {
  runCommand,
  imagesToPDF,
  getFileSizeInHumanReadableFormat,
} from '../model/utils.js'
import jmDownload from '../model/jmDownload.js'
import { _DataPath, pluginAuthor } from '../data/system/pluginConstants.js'
import common from '../../../lib/common/common.js'
import fs from 'fs'

export class jmDownloadApp extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: '[TJ插件]JM下载',
      /** 功能描述 */
      dsc: 'JM下载',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 1000,
      rule: [
        {
          reg: '^#?(JM|jm|JMComic|jmcomic)(.*)$',
          fnc: 'jmDownload',
        },
      ],
    })
  }

  async jmDownload() {
    // 一些预检
    if (!config.getConfig().JMComic.enable) {
      await this.reply('JMComic 功能未启用', true)
      return
    }

    let id = this.e.msg.replace(/#|JM|jm|JMComic|jmcomic|：|:/g, '').trim()
    if (!id) {
      await this.reply('不带 ID 我怎么下嘛!', true)
      return
    }

    // 判断 ID 是否为纯数字
    if (!/^\d+$/.test(id)) {
      await this.reply('ID 只能是数字哦!', true)
      return
    }

    // 检查 JMComic 命令是否存在
    if (!jmDownload.commandExists) {
      tjLogger.info('JMComic 命令不存在, 任务终止')
      this.reply('JMComic 不存在, 请先安装', true)
      return
    }

    // 检查消息渠道是否为群聊或私聊
    if (!this.e.isGroup && !this.e.isPrivate) {
      await this.reply('不支持的消息来源, 请在群聊或私聊使用', true)
      return
    }

    // 去除 id 可能存在的开头的 0
    id = parseInt(id).toString()

    let msg = `准备下载 JMComic ID: ${id}`
    let jmPrepareMsg = await this.reply(msg, true)

    // 变量
    let command = ''
    let commandResult = {}
    let downloadPath = `${jmDownload.downloadPathPrefix}/${id}`
    let pdfPassword = config.getConfig().JMComic.pdfPassword
    const pdfPath = `${jmDownload.convertPathPrefix}/${id}${
      pdfPassword ? `_Password` : ''
    }.pdf`
    tjLogger.debug(
      `准备下载 JMComic ID: ${id}, qq=${this.e.user_id}, path=${downloadPath}, pdfPath=${pdfPath}, password=${pdfPassword}`,
    )

    // 如果downloadPath存在, 说明有相同任务正在下载, 循环等待到目录不存在再继续
    const maxWaitTime = 10 * 60 * 1000 // 10分钟
    const startTime = Date.now()

    while (fs.existsSync(downloadPath)) {
      if (Date.now() - startTime > maxWaitTime) {
        tjLogger.warn(`等待下载目录释放超时: ${downloadPath}`)
        this.reply(`等待下载目录释放超时, 待会再试试吧~`, true)
        if (this.e.group) this.e.group.recallMsg(jmPrepareMsg.message_id)
        if (this.e.private) this.e.private.recallMsg(jmPrepareMsg.message_id)
        return
      }
      await common.sleep(2500)
      tjLogger.debug(`JMComic ID: ${id} 已有相同任务在下载, 等待中...`)
    }

    // 开始下载前, 先检查存档目录是否存在此 ID 的存档, 以便复制当缓存加速下载
    const archiveDownloadPath = `${jmDownload.archiveDownloadPathPrefix}/${id}`
    if (fs.existsSync(archiveDownloadPath)) {
      // 存档目录存在, 复制到下载缓存目录
      fs.cpSync(archiveDownloadPath, downloadPath, { recursive: true })
      tjLogger.info(
        `从归档目录复制 JMComic 下载的图片以加速下载: ${archiveDownloadPath}`,
      )
    } else {
      // 存档目录不存在, 创建下载缓存目录
      await fs.mkdirSync(downloadPath, { recursive: true })
      tjLogger.debug(`创建 JMComic 下载缓存目录: ${downloadPath}`)
    }
    // 开始下载
    tjLogger.info(`开始下载 JMComic ID: ${id}`)
    command = `jmcomic ${id} --option="${_DataPath}/JMComic/option.yml"`
    commandResult = await runCommand(command)

    // 下载完成, 撤回准备消息
    if (this.e.group) this.e.group.recallMsg(jmPrepareMsg.message_id)
    if (this.e.private) this.e.private.recallMsg(jmPrepareMsg.message_id)

    if (!commandResult.output) {
      // 运行出现错误
      jmDownload.delTempFile(1, downloadPath, false, id)
      await this.reply(
        `下载失败, 请检查 ID 是否正确. 错误信息: ${commandResult.err}`,
        true,
      )
      return
    } else if (commandResult.output.includes('jmcomic.jm_exception')) {
      // 命令结果有 JMComic 的报错
      jmDownload.delTempFile(1, downloadPath, false, id)
      // 出错了, 取回 jmcomic 报错的内容
      const match = commandResult.output.match(
        /jmcomic\.jm_exception\.[^\s(]+.*?,\s*[^(\s]+\s*\(([^)]+)\)/,
      )
      if (match) {
        let errorMessage = match[1].trim()

        // 移除可能的单引号或双引号
        errorMessage = errorMessage.replace(/^['"]|['"]$/g, '')

        // 尝试解析可能的 JSON 错误信息
        try {
          const errorObj = JSON.parse(errorMessage)
          errorMessage = errorObj.errorMsg || errorMessage
        } catch {
          // 如果不是 JSON 格式,保持原样
        }

        // 处理特定错误消息
        if (errorMessage.includes('请求的本子不存在')) {
          errorMessage = '此 ID 不存在或登录可见'
        }

        tjLogger.warn(`下载 JMComic ${id} 失败: ${errorMessage}`)
        this.reply(
          `下载失败, 错误信息: \n${errorMessage.replace(/\\n/g, '\n').trim()}`,
          true,
        )
      } else {
        // 未能识别的错误,发送完整日志
        tjLogger.warn(`下载 JMComic ${id} 失败: 无法识别的错误`)
        let msg = await common.makeForwardMsg(
          this.e,
          [
            'JM 下载失败, 未识别的错误, 日志如下: ',
            commandResult.output.replace(/\\n/g, '\n').trim(),
            '请向机器人主人或插件开发者反馈此问题',
          ],
          'JM 下载失败',
        )
        await this.reply(msg, true)
        return
      }
    } else if (commandResult.output.includes('本子下载完成')) {
      // 下载成功
      let downloadSuccessMsg = await this.reply('下载成功, 准备转换...', true)
      // 先给目录重命名加上时间戳后缀防止同时重复下载冲突
      const timeStamp = Date.now()
      await fs.renameSync(downloadPath, `${downloadPath}_${timeStamp}`)
      downloadPath += `_${timeStamp}`
      // 如果pdfPath存在, 则先删除
      if (fs.existsSync(pdfPath)) {
        jmDownload.delTempFile(2, pdfPath, false, id)
      }
      // 开始将该路径中的图片合并成 PDF
      let convertResult = await imagesToPDF(
        downloadPath,
        pdfPath,
        `JMComic-${id}_Powered-By-${pluginAuthor}`,
        pdfPassword,
        {
          author: pluginAuthor,
          subject: `JMComic${id}`,
          keywords: ['JMComic', `JMComic${id}`, `jm${id}`],
        },
      )
      // 合成 PDF 结束后删除下载文件
      jmDownload.delTempFile(1, downloadPath, true, id)
      tjLogger.debug(`图片转 PDF 结果: ${convertResult}`)
      if (convertResult == pdfPath) {
        // 计算 PDF 文件大小
        const pdfSize = getFileSizeInHumanReadableFormat(pdfPath)
        let prepareMsg = `转 PDF 成功, 文件大小 ${pdfSize}, 准备${
          config.getConfig().JMComic.sendFilePolicy == 3
            ? `上传到内置服务器`
            : `发送`
        }...`
        let prepareSendFileMsg = await this.reply(prepareMsg, true)
        if (this.e.isGroup)
          this.e.group.recallMsg(downloadSuccessMsg.message_id)
        if (this.e.isPrivate)
          this.e.private.recallMsg(downloadSuccessMsg.message_id)

        // 发送 PDF
        let sendPdfRet = await jmDownload.sendPdf(
          pdfPath,
          pdfSize,
          pdfPassword,
          this.e,
        )
        // 发送操作完后删掉 PDF
        jmDownload.delTempFile(2, pdfPath, true, id)
        if (sendPdfRet) {
          // 返回非空, 说明处理失败
          this.reply(`发送 PDF 操作失败: ${sendPdfRet}`)
        }
        if (this.e.isGroup)
          this.e.group.recallMsg(prepareSendFileMsg.message_id)
        if (this.e.isPrivate)
          this.e.private.recallMsg(prepareSendFileMsg.message_id)
      } else {
        jmDownload.delTempFile(2, pdfPath, false, id)
        this.reply(`图片转 PDF 失败, 错误信息: ${convertResult}`, true)
      }
    } else {
      // 这真的是未知错误了
      jmDownload.delTempFile(1, downloadPath, false, id)
      let msg = await common.makeForwardMsg(
        this.e,
        [
          'JM 下载失败, 未识别的错误, 日志如下: ',
          commandResult.output.replace(/\\n/g, '\n').trim(),
          '请向机器人主人或插件开发者反馈此问题',
        ],
        'JM 下载失败',
      )
      await this.reply(msg, true)
    }
  }
}

// 在插件加载时执行初始化
jmDownload.init()
