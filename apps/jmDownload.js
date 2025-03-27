import path from 'path';
import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import { runCommand, imagesToPDF } from '../model/utils.js'
import httpServer from '../model/httpServer.js'
import { _DataPath } from '../data/system/pluginConstants.js'
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

  static commandExists = false
  static downloadPathPrefix = `${_DataPath}/JMComic/cache/download`
  static convertPathPrefix = `${_DataPath}/JMComic/cache/convert`
  static targetDir = `${_DataPath}/JMComic/download`

  /** 插件初始化时执行 */
  static async init() {
    await checkCommand()
    // 清理临时文件目录
    try {
      // 清理下载目录内的所有子目录
      if (fs.existsSync(this.downloadPathPrefix)) {
        const downloadDirs = fs.readdirSync(this.downloadPathPrefix)
        for (const dir of downloadDirs) {
          const dirPath = `${this.downloadPathPrefix}/${dir}`
          if (fs.statSync(dirPath).isDirectory()) {
            fs.rmSync(dirPath, { recursive: true, force: true })
            tjLogger.info(`已清理 JMComic 临时文件: ${dirPath}`)
          }
        }
        tjLogger.debug('完成清理 JMComic 临时下载文件')
      }
      // 清理转换目录内的所有PDF文件
      if (fs.existsSync(this.convertPathPrefix)) {
        const convertFiles = fs.readdirSync(this.convertPathPrefix)
        for (const file of convertFiles) {
          if (file.endsWith('.pdf')) {
            fs.unlinkSync(`${this.convertPathPrefix}/${file}`)
            tjLogger.info(`已清理 JMComic 临时文件: ${file}`)
          }
        }
        tjLogger.debug('完成清理 JMComic 临时转换文件')
      }
    } catch (err) {
      tjLogger.warn(`清理 JMComic 临时文件出错: ${err.message}`)
    }
  }

  async jmDownload() {
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

    // 去除 id 可能存在的开头的 0
    id = parseInt(id).toString()

    tjLogger.debug(`准备下载 JMComic ID: ${id}, qq=${this.e.user_id}`)
    let msg = `准备下载 JMComic ID: ${id}`
    let jmPrepareMsg = await this.reply(msg, true)
    let command = ''
    let commandResult = {}
    const downloadPath = `${jmDownloadApp.downloadPathPrefix}/${id}`
    const pdfPath = `${jmDownloadApp.convertPathPrefix}/${id}.pdf`
    if (!jmDownloadApp.commandExists) {
      // 命令不存在
      tjLogger.info('JMComic 命令不存在, 任务终止')
      this.reply('JMComic 不存在, 请先安装', true)
      if (this.e.group) this.e.group.recallMsg(jmPrepareMsg.message_id)
      if (this.e.friend) this.e.friend.recallMsg(jmPrepareMsg.message_id)
      return
    }

    // 开始下载
    tjLogger.debug(`开始下载 JMComic ID: ${id}`)
    // 如果downloadPath存在, 则先删除
    if (fs.existsSync(downloadPath)) {
      fs.rmSync(downloadPath, { recursive: true, force: true })
      tjLogger.info(`已清理 JMComic 临时文件: ${downloadPath}`)
    }
    command = `jmcomic ${id} --option="${_DataPath}/JMComic/option.yml"`
    commandResult = await runCommand(command)
    tjLogger.debug(`jmcomic 下载结果: ${JSON.stringify(commandResult)}`)

    // 下载完成, 撤回准备消息
    if (this.e.group) this.e.group.recallMsg(jmPrepareMsg.message_id)
    if (this.e.friend) this.e.friend.recallMsg(jmPrepareMsg.message_id)

    if (!commandResult.output) {
      // 运行出现错误
      await this.reply(
        `下载失败, 请检查 ID 是否正确. 错误信息: ${commandResult.err}`,
        true
      )
      return
    } else if (commandResult.output.includes('jmcomic.jm_exception')) {
      // 命令结果有 JMComic 的报错
      // 出错了, 取回 jmcomic 报错的内容
      const match = commandResult.output.match(
        /MissingAlbumPhotoException\('([^']+)/
      )
      if (match) {
        if (match[1]?.includes('请求的本子不存在'))
          match[1] = '此 ID 不存在或登录可见'
        this.reply(
          `下载失败, 错误信息: \n${match[1].replace(/\\n/g, '\n').trim()}`,
          true
        )
      } else {
        let msg = await common.makeForwardMsg(
          this.e,
          [
            'JM 下载失败, 未识别的错误, 日志如下: ',
            commandResult.output.replace(/\\n/g, '\n').trim(),
            '请向机器人主人或插件开发者反馈此问题',
          ],
          'JM 下载失败'
        )
        await this.reply(msg, true)
        return
      }
    } else if (commandResult.output.includes('本子下载完成')) {
      // 下载成功
      let downloadSuccessMsg = await this.reply('下载成功, 准备转换...', true)
      // 如果pdfPath存在, 则先删除
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath)
        tjLogger.info(`已清理 JMComic 临时文件: ${pdfPath}`)
      }
      // 开始将该路径中的图片合并成 PDF
      let convertResult = await imagesToPDF(
        downloadPath,
        pdfPath,
        `JMComic-${id}_Powered-By-TomyJan`
      )
      tjLogger.debug(`图片转 PDF 结果: ${convertResult}`)
      if (convertResult == pdfPath) {
        // 转换成功删掉下载的图片
        tjLogger.debug(`清理 JMComic 临时文件: ${downloadPath}`)
        fs.rm(downloadPath, { recursive: true, force: true }, (err) => {
          if (err)
            tjLogger.warn(
              `删除下载的图片路径 ${downloadPath} 失败: ${err.message}`
            )
        })
        let prepareSendFileMsg = await this.reply(
          '转 PDF 成功, 准备发送...',
          true
        )
        // 发送 PDF
        if (this.e.isGroup) {
          this.e.group.recallMsg(downloadSuccessMsg.message_id)
          let ret
          try {
            ret = await this.e.group.fs.upload(pdfPath)
          } catch (e) {
            if (e.message == 'group space not enough')
              e.message = '群文件空间不足'
            tjLogger.error(`发送文件失败: ${e.message}`)
            ret = null
            let msg = `文件发送失败, 错误信息: \n${e.message}`
            if (
              config.getConfig().httpServer.enable &&
              e.message != '群文件空间不足'
            ) {
              msg += `\n将尝试上传到内置服务器...`
              let msgId = await this.reply(msg, true)
              let tmpFileUrl = httpServer.createTmpFileUrl(pdfPath, 300)
              if (tmpFileUrl) {
                msg = `点击链接下载: \n${tmpFileUrl}\n链接有效期约 5 分钟`
                this.e.group.recallMsg(msgId.message_id)
                this.reply(msg, true)
              }
            } else {
              this.reply(msg, true)
            }
          }
          tjLogger.debug(`发送文件结果: ${JSON.stringify(ret)}`)
          if(config.getConfig().keppFile){
            // 新增移动到归档目录逻辑
            if (!fs.existsSync(this.targetDir)) {
              fs.mkdirSync(this.targetDir, { recursive: true });
            }
            const targetPath = path.join(this.targetDir, path.basename(pdfPath));
            fs.renameSync(pdfPath, targetPath);
            tjLogger.info(`已移动 PDF 文件到归档目录: ${targetPath}`);
          }else {
            fs.unlinkSync(pdfPath)
          }
          this.e.group.recallMsg(prepareSendFileMsg.message_id)
          if (ret !== null && typeof ret !== 'object') {
            return `文件发送失败, 可能是协议不支持`
          }
          return null
        } else if (this.e.isPrivate) {
          this.e.friend.recallMsg(downloadSuccessMsg.message_id)
          let ret
          try {
            ret = await this.e.friend.sendFile(pdfPath)
          } catch (e) {
            tjLogger.error(`发送文件失败: ${e.message}`)
            ret = null
            // this.reply(`文件发送失败, 错误信息: ${e.message}`, true)
            let msg = `文件发送失败, 错误信息: \n${e.message}`
            if (config.getConfig().httpServer.enable) {
              msg += `\n将尝试上传到内置服务器...`
              let msgId = await this.reply(msg, true)
              let tmpFileUrl = httpServer.createTmpFileUrl(pdfPath, 300)
              if (tmpFileUrl) {
                msg = `点击链接下载: \n${tmpFileUrl}\n链接有效期约 5 分钟`
                this.e.friend.recallMsg(msgId.message_id)
                this.reply(msg, true)
              }
            } else {
              this.reply(msg, true)
            }
          }
          tjLogger.debug(`发送文件结果: ${JSON.stringify(ret)}`)
          tjLogger.debug(`清理 JMComic 临时文件: ${pdfPath}`)
          if(config.getConfig().keppFile){
            // 新增移动到归档目录逻辑
            if (!fs.existsSync(this.targetDir)) {
              fs.mkdirSync(this.targetDir, { recursive: true });
            }
            const targetPath = path.join(this.targetDir, path.basename(pdfPath));
            fs.renameSync(pdfPath, targetPath);
            tjLogger.info(`已移动 PDF 文件到归档目录: ${targetPath}`);
          }else {
            fs.unlinkSync(pdfPath)
          }
          this.e.friend.recallMsg(prepareSendFileMsg.message_id)
          if (ret !== null && typeof ret !== 'object') {
            return `文件发送失败, 可能是协议不支持`
          }
          return null
        } else {
          return `不支持的消息来源, 无法发送文件, 请尝试在群聊使用`
        }
      } else {
        this.reply(`图片转 PDF 失败, 错误信息: ${convertResult}`, true)
      }
    } else {
      // 这真的是未知错误了
      let msg = await common.makeForwardMsg(
        this.e,
        [
          'JM 下载失败, 未识别的错误, 日志如下: ',
          commandResult.output.replace(/\\n/g, '\n').trim(),
          '请向机器人主人或插件开发者反馈此问题',
        ],
        'JM 下载失败'
      )
      await this.reply(msg, true)
    }
  }
}

async function checkCommand() {
  // 启动时检查命令是否存在
  tjLogger.debug('开始检查 JMComic 命令是否存在')
  let command = 'jmcomic'
  let commandResult = {}
  commandResult = await runCommand(command)
  tjLogger.debug(`jmcomic 命令测试结果: ${JSON.stringify(commandResult)}`)
  if (!commandResult.output) {
    // 命令不存在
    jmDownloadApp.commandExists = false
    tjLogger.error(
      'JMComic 命令不存在, JM 下载功能将不可用, 请先按照教程安装 JMComic 并重启 Bot'
    )
  } else {
    // 命令存在
    jmDownloadApp.commandExists = true
    tjLogger.info('JMComic 命令存在, JM 下载功能可用')
  }
}

// 在插件加载时执行初始化
jmDownloadApp.init()

