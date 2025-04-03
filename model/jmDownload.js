import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import { runCommand } from './utils.js'
import httpServer from './httpServer.js'
import { _DataPath } from '../data/system/pluginConstants.js'
import fs from 'fs'

export default class jmDownload {
  static commandExists = false
  static downloadPathPrefix = `${_DataPath}/JMComic/cache/download`
  static convertPathPrefix = `${_DataPath}/JMComic/cache/convert`
  static archiveDownloadPathPrefix = `${_DataPath}/JMComic/archive/download`
  static archiveConvertPathPrefix = `${_DataPath}/JMComic/archive/convert`

  /**
   * 初始化服务
   */
  static async init() {
    await this.checkCommand()
    await this.cleanTempFiles()
  }

  /**
   * 检查命令是否存在
   */
  static async checkCommand() {
    tjLogger.debug('开始检查 JMComic 命令是否存在')
    let commandResult = await runCommand('jmcomic')
    if (!commandResult.output) {
      this.commandExists = false
      tjLogger.error(
        'JMComic 命令不存在, JM 下载功能将不可用, 请先按照教程安装 JMComic 并重启 Bot'
      )
    } else {
      this.commandExists = true
      tjLogger.info('JMComic 命令存在, JM 下载功能可用')
    }
  }

  /**
   * 清理所有 JMComic 临时文件
   */
  static async cleanTempFiles() {
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

  /**
   * 删除指定的 JMComic 临时文件(夹)
   * @param {number} type 类型, 1=图片目录, 2=PDF文件
   * @param {string} path 文件(夹)的路径
   * @param {Boolean} valid 文件是否有效, 功能预留参数
   * @param {string} id JMComic ID, 用于给归档命名. 因为下载成功的图片文件夹已经重命名过了提取会麻烦
   */
  static async delTempFile(type, path, valid, id) {
    tjLogger.debug(
      `删除 JMComic 临时文件 ${path} , type=${type}, valid=${valid}`
    )
    // TODO: 预留 valid 参数, 为下一步归档下载的图片 / PDF 功能用, 注意如果要归档图片文件夹, 还需要判断最后一部分有没有 _ , 如果有归档后要删掉 _ 及之后的部分
    let archiveDownloadedImg = config.getConfig().JMComic.archiveDownloadedImg
    let archiveConvertedPdf = config.getConfig().JMComic.archiveConvertedPdf
    try {
      // 检查路径是否存在
      if (!fs.existsSync(path)) {
        tjLogger.warn(`删除 JMComic 临时文件 ${path} 失败, 文件(夹)不存在`)
        return
      }

      if (type === 1) {
        // 删除图片文件夹
        if (fs.statSync(path).isDirectory()) {
          // 先判断是否需要归档
          if (archiveDownloadedImg) {
            const archivePath = `${this.archiveDownloadPathPrefix}/${id}`

            if (fs.existsSync(archivePath)) {
              fs.rmSync(archivePath, { recursive: true, force: true })
            }
            fs.mkdirSync(archivePath, { recursive: true })

            const files = fs.readdirSync(path)
            for (const file of files) {
              const srcFile = `${path}/${file}`
              const destFile = `${archivePath}/${file}`
              fs.copyFileSync(srcFile, destFile)
            }
            tjLogger.info(`已归档 JMComic 下载的图片: ${archivePath}`)
          }
          await fs.rm(path, { recursive: true, force: true }, (err) => {
            if (err)
              tjLogger.warn(
                `删除 JMComic 临时文件 ${path} 失败: ${err.message}`
              )
          })
        } else {
          tjLogger.warn(
            `删除 JMComic 临时文件 ${path} 失败: 文件不存在或不是目录, type=${type}`
          )
        }
      } else if (type === 2) {
        // 删除 PDF 文件
        if (fs.statSync(path).isFile()) {
          // 先判断是否需要归档
          if (archiveConvertedPdf) {
            const pdfPwd = config.getConfig().JMComic.pdfPassword
            const archivePath = `${this.archiveConvertPathPrefix}/${id}${
              pdfPwd ? `_Password_${pdfPwd}` : ''
            }.pdf`
            fs.copyFileSync(path, archivePath, fs.constants.COPYFILE_FICLONE)
            tjLogger.info(`已归档 JMComic 转换的 PDF: ${archivePath}`)
          }
          await fs.unlink(path, (err) => {
            if (err)
              tjLogger.warn(
                `删除 JMComic 临时文件 ${path} 失败: ${err.message}`
              )
          })
        } else {
          tjLogger.warn(
            `删除 JMComic 临时文件 ${path} 失败: 文件不存在或不是文件, type=${type}`
          )
        }
      } else {
        tjLogger(`删除 JMComic 临时文件 ${path} 失败, 不支持的 type: ${type}`)
      }
    } catch (error) {
      console.warn(`删除 JMComic 临时文件 ${path} 失败: ${error.message}`)
    }
  }

  /**
   * 发送 PDF 或下载链接
   * @param {string} pdfPath 要发送的 PDF 目录
   * @param {string} pdSize 转换好的 PDF 大小
   * @param {string} pdfPassword PDF 密码
   * @param {object} e 消息对象
   * @return {Promise<void|string>} 处理成功(包括发送成功/发送失败)返回 void, 失败返回 string 原因
   */
  static async sendPdf(pdfPath, pdfSize, pdfPassword, e) {
    if (!e.isGroup && !e.isPrivate) return '未知消息来源, 请检查'
    let sendFileRet
    let sendFilePolicy = config.getConfig().JMComic.sendFilePolicy
    tjLogger.debug(
      `发送 PDF 策略: ${sendFilePolicy}, (1=只传文件, 2=优先文件, 3=只传链接)`
    )

    if (sendFilePolicy == 1 || sendFilePolicy == 2) {
      // 只传文件或优先传文件
      try {
        if (e.isGroup) sendFileRet = await e.group.fs.upload(pdfPath)
        else sendFileRet = await e.private.sendFile(pdfPath)
      } catch (err) {
        // 发送文件出问题
        tjLogger.error(`发送文件失败: ${err.message}`)
        if (err.message == 'group space not enough')
          err.message = '群文件空间不足'
        else if (err.message.includes('send feed not all success'))
          // send feed not all success. failed_count=1 , 大概是协议问题
          err.message = '部分分片未发送成功'
        else if (err.message.includes('unknown highway error'))
          // 大概也是协议问题
          err.message = '未知通道错误'

        let msg = `文件发送失败, 错误信息: \n${err.message}`

        if (sendFilePolicy == 2 && err.message != '群文件空间不足') {
          // 发送策略为优先文件并且错误不是群文件空间不足的话, 尝试创建临时链接
          msg += `\n将尝试上传到内置服务器...`
          let msgId = await e.reply(msg, true)
          let sendLinkRet = await sendLink()
          e.group.recallMsg(msgId.message_id)
          e.reply(sendLinkRet, true)
        } else {
          e.reply(msg, true)
        }

        return
      }

      // 发送文件没报错
      tjLogger.debug(`发送文件结果: ${JSON.stringify(sendFileRet)}`)
      if (sendFileRet !== null && typeof sendFileRet == 'object') {
        // 返回了对象说明发送成功
        tjLogger.info(`发送文件成功: ${pdfPath}`)
        if (config.getConfig().JMComic.sendPdfPassword && pdfPassword) {
          tjLogger.debug(`发送密码 ${pdfPassword}, pdfPath=${pdfPath}`)
          e.reply(`文件发送成功, 密码: ${pdfPassword}`)
        }
      } else if (sendFileRet !== null) {
        // 发送返回非空, 那就报下错吧
        e.reply(`发送文件出问题: ${sendFileRet}`)
      } else {
        // 发送返回空, 这啥情况
        e.reply(`发送文件出问题, 返回为空`)
      }

      return
    } else if (sendFilePolicy == 3) {
      // 发送策略为只传链接
      let sendLinkRet = await sendLink()
      e.reply(sendLinkRet, true)
    } else {
      e.reply(`未知的发送策略 ${sendFilePolicy}, 请检查`, true)
    }

    async function sendLink() {
      let tmpFileUrl = httpServer.createTmpFileUrl(pdfPath, 300)
      if (tmpFileUrl) {
        let ret = `文件大小: ${pdfSize}\n${
          config.getConfig().JMComic.sendPdfPassword && pdfPassword
            ? `密码: ${pdfPassword}\n`
            : ''
        }点击链接下载: \n${tmpFileUrl}\n链接有效期约 5 分钟`
        return ret
      } else {
        return '创建临时链接失败'
      }
    }
  }
}
