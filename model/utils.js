import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import crypto from 'crypto'
import {
  dataPath,
  resPath,
  pluginAuthor,
  pluginName,
  pluginVer,
} from '../data/system/pluginConstants.js'
import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import formatDistanceToNow from 'date-fns/formatDistanceToNow'
import zhCN from 'date-fns/locale/zh-CN'
import { Buffer } from 'buffer'
import { isWin } from '../data/system/pluginConstants.js'
import { exec } from 'child_process'
import iconv from 'iconv-lite'
import pkg from 'pdf-lib-plus-encrypt'
const { PDFDocument } = pkg
import sharp from 'sharp'

/**
 * 程序延时
 * @param {number} sleepms 延时时间
 * @returns {Promise<void>}
 */
export function sleepAsync(sleepms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, sleepms)
  })
}

/**
 * 获取随机整数
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @returns {number} 随机整数
 */
export function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min
}

/**
 * 获取当前月份天数
 * @returns {number} 当前月份天数
 */
export async function mGetDate() {
  var date = new Date()
  var year = date.getFullYear()
  var month = date.getMonth() + 1
  var d = new Date(year, month, 0)
  return d.getDate()
}

/**
 * 根据输入字符串生成固定 UUID
 * @param {*} inputString 输入字符串
 * @returns {string} UUID
 */
export function generateUUID(inputString) {
  const md5Hash = crypto.createHash('md5')
  md5Hash.update(inputString)
  const hash = md5Hash.digest('hex')

  // Format the hash into UUID-like string
  const uuid =
    hash.substring(0, 8) +
    '-' +
    hash.substring(8, 12) +
    '-' +
    '4' +
    hash.substring(13, 16) +
    '-' +
    'a' +
    hash.substring(17, 20) +
    '-' +
    hash.substring(20, 32)

  tjLogger.debug(`使用 ${inputString} 生成 UUID ${uuid}`)
  return uuid
}

/**
 * 根据输入字符串生成固定字符串
 * @param {*} inputString 输入字符串
 * @param {number} length 字符串长度, 默认为40, 最长为64
 * @returns {string} 固定字符串
 */
export function generateFixedString(inputString, length = 40) {
  if (!inputString) {
    tjLogger.warn('生成固定字符串输入为空, 使用默认值 1')
    inputString = '1'
  }
  inputString = inputString.toString()
  if (length > 64) {
    length = 64
    tjLogger.warn(
      `使用 ${inputString} 生成长度 ${length} 超过最大值, 已自动调整为64`,
    )
  }
  const sha256Hash = crypto.createHash('sha256')
  sha256Hash.update(inputString)
  const hash = sha256Hash.digest('hex').toUpperCase()

  // 截取前40个字符作为结果
  const fixedString = hash.substring(0, length)

  tjLogger.debug(
    `使用 ${inputString} 生成长度为 ${length} 的固定字符串 ${fixedString}`,
  )
  return fixedString
}

/**
 * 更新卡片要用的背景图片
 * @returns {boolean} 是否成功更新背景图片
 */
export function updateCardBg() {
  let defaultCardBgPath = resPath + '/img/common/bg/Alisa-Echo_0.jpg'
  let cardBgPath = dataPath + '/system/cachedImg/cardBg.jpg'
  let tmpCardBgPath = dataPath + '/system/cachedImg/cardBgTmp.jpg'
  let imgDownloadUrl = 'https://api.tomys.top/api/pnsWallPaper'

  if (!config.getConfig().useRandomBgInCard) {
    // 没使用随机背景图片
    try {
      let cardBgExist = fs.existsSync(cardBgPath)
      if (
        !cardBgExist ||
        fs.statSync(cardBgPath).size !== fs.statSync(defaultCardBgPath).size
      ) {
        if (fs.existsSync(cardBgPath)) fs.unlinkSync(cardBgPath)
        fs.copyFileSync(defaultCardBgPath, cardBgPath)
      }
      return true
    } catch (err) {
      tjLogger.warn('复制卡片默认背景图片错误:', err.message)
      return false
    }
  }

  // 获取随机背景图片
  fetch(imgDownloadUrl, { method: 'GET', timeout: 5000 })
    .then((rsp) => {
      if (
        rsp.status === 301 ||
        rsp.status === 302 ||
        rsp.status === 307 ||
        rsp.status === 308
      ) {
        let location = rsp.headers.get('location')
        tjLogger.debug(
          '更新卡片背景图片重定向:',
          rsp.status,
          rsp.statusText,
          'url:',
          location,
        )
        return fetch(location, { method: 'GET', timeout: 5000 })
      }
      return rsp
    })
    .then((rsp) => {
      if (rsp.ok) {
        tjLogger.debug('更新卡片背景图片响应:', rsp.status, rsp.statusText)
        return rsp.arrayBuffer()
      } else {
        tjLogger.warn(
          '更新卡片背景图片错误:',
          rsp.status,
          rsp.statusText,
          rsp.url,
        )
      }
    })
    .then((buffer) => {
      fs.writeFileSync(tmpCardBgPath, Buffer.from(buffer))
      if (fs.existsSync(cardBgPath)) fs.unlinkSync(cardBgPath)
      fs.renameSync(tmpCardBgPath, cardBgPath)
      return true
    })
    .catch((err) => {
      tjLogger.warn('更新卡片背景图片错误:', err.message)
      if (!fs.existsSync(cardBgPath))
        fs.copyFileSync(defaultCardBgPath, cardBgPath)
      return false
    })
}

/**
 * 格式化时间戳为人类易读的时间
 * @param {number} timestamp 时间戳
 * @returns {string} 人类易读的时间
 */
export function formatTimestampInReadableFormat(timestamp) {
  if (!timestamp) return '已经'
  if (timestamp.toString().length === 10) {
    timestamp = timestamp * 1000
  }
  return formatDistanceToNow(new Date(timestamp), {
    locale: zhCN,
    addSuffix: true,
  })
}

/**
 * 发送好友消息
 * @param QQ QQ号
 * @param msg 消息
 */
export async function sendMsgFriend(uin, msg) {
  uin = Number(uin)
  // 延迟五秒
  // await sleepAsync(5000)
  // eslint-disable-next-line no-undef
  let friend = Bot.fl.get(uin)
  if (friend || config.getConfig().attemptSendNonFriend) {
    tjLogger.debug(
      // eslint-disable-next-line no-undef
      `bot ${config.getConfig().botQQ || Bot.uin} 发送好友消息[${
        friend?.nickname
      }](${uin})`,
    )
    // 如果 Bot 是 array 则使用配置的 Bot
    // eslint-disable-next-line no-undef
    let tmpBot = Bot
    // eslint-disable-next-line no-undef
    if (Array.isArray(Bot)) {
      // eslint-disable-next-line no-undef
      tmpBot = Bot[config.getConfig().botQQ || 0]
    }
    return await tmpBot
      .pickUser(uin)
      .sendMsg(msg)
      .catch((err) => {
        tjLogger.error('发送好友消息错误:', err.message)
      })
  } else {
    tjLogger.warn(`${uin} 非好友, 无法推送消息`)
  }
}

/**
 * 执行命令
 * @param {string} command 命令
 * @returns {Promise<{output: string, err: string}>} 命令执行结果
 */
export async function runCommand(command) {
  tjLogger.debug(`开始执行命令: ${command}`)
  return await new Promise((resolve) => {
    exec(
      command,
      { encoding: isWin ? 'buffer' : 'utf8' },
      (error, stdout, stderr) => {
        const output = (isWin ? iconv.decode(stdout, 'gbk') : stdout).trim()
        const err = (isWin ? iconv.decode(stderr, 'gbk') : stderr).trim()

        if (error) {
          tjLogger.warn(`执行命令 ${command} 出错: ${err}`)
        } else {
          tjLogger.debug(`执行命令 ${command} 结果: ${output}`)
        }

        resolve({ output, err })
      },
    )
  })
}

/**
 * 将目录下的图片转为 PDF
 * @param {string} inputDir 输入目录
 * @param {string} outputPath 输出 PDF 路径
 * @param {string} pdfTitle PDF 标题
 * @param {string} [password] PDF 密码，可选
 * @param {Object} [metadata] PDF 元信息，可选
 * @param {string} [metadata.author] 作者
 * @param {string} [metadata.subject] 主题
 * @param {Array<string>} [metadata.keywords] 关键词
 * @returns {Promise<string>} 转换成功返回 PDF 路径
 */
export async function imagesToPDF(
  inputDir,
  outputPath,
  pdfTitle,
  password,
  metadata = {},
) {
  tjLogger.debug('将目录下的图片转为 PDF:', inputDir, outputPath)
  const files = fs
    .readdirSync(inputDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort()

  const pdfDoc = await PDFDocument.create()

  // 设置标题和其他元信息
  pdfDoc.setTitle(pdfTitle)
  if (metadata?.author) pdfDoc.setAuthor(metadata.author)
  if (metadata?.subject) pdfDoc.setSubject(metadata.subject)
  if (metadata?.keywords) pdfDoc.setKeywords(metadata.keywords)
  let copyRightAuthor = `${pluginAuthor}/${pluginName}@${pluginVer}`
  pdfDoc.setCreator(copyRightAuthor)
  pdfDoc.setProducer(copyRightAuthor)

  for (const file of files) {
    const imgPath = path.join(inputDir, file)
    const imgBuffer = fs.readFileSync(imgPath)

    // 获取图片尺寸
    const { width, height } = await sharp(imgBuffer).metadata()

    const imgSharp = sharp(imgBuffer).jpeg()
    const jpegBuffer = await imgSharp.toBuffer()
    const embeddedImage = await pdfDoc.embedJpg(jpegBuffer)

    const page = pdfDoc.addPage([width, height])
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width,
      height,
    })
  }

  // 设置加密选项
  if (password) {
    await pdfDoc.encrypt({
      userPassword: password,
      ownerPassword: password,
      permissions: {
        printing: 'highResolution', // 允许高质量打印
        modifying: false, // 禁止修改 PDF 文档
        copying: true, // 允许复制 PDF 中的内容
        annotating: false, // 禁止添加注释
        fillingForms: false, // 禁止填写 PDF 表单
        contentAccessibility: false, // 禁止内容访问
        documentAssembly: false, // 禁止文档组装
      },
    })
  }

  const pdfBytes = await pdfDoc.save()
  fs.writeFileSync(outputPath, pdfBytes)
  tjLogger.info('成功转换 PDF:', outputPath)

  return outputPath
}

/**
 * 计算传入的文件大小, 转换为人类易读的格式
 * @param {string} filePath 文件路径
 * @returns {string} 人类易读的文件大小
 */
export function getFileSizeInHumanReadableFormat(filePath) {
  const stats = fs.statSync(filePath)
  const sizeInBytes = stats.size
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let size = sizeInBytes
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index++
  }
  return `${size.toFixed(2)}${units[index]}`
}
