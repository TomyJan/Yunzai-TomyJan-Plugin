import config from '../components/config.js'
import { _DataPath } from '../data/system/pluginConstants.js'
import http from 'http'
import fs from 'fs'
import path from 'path'
import tjLogger from '../components/logger.js'
import crypto from 'crypto'

class httpServer {
  constructor() {
    this.rootDir = _DataPath + '/httpServer/root'
    this.server = null
    this.init()
  }

  /**
   * 发送错误响应
   * @param {http.ServerResponse} res - 响应对象
   * @param {number} statusCode - HTTP状态码
   * @param {string} message - 错误信息
   */
  sendErrorResponse(res, statusCode, message) {
    if (!res.headersSent) {
      res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
      })
      res.end(message)
    }
  }

  init() {
    try {
      const serverConfig = config.getConfig().httpServer
      if (!serverConfig.enable) {
        tjLogger.info('HTTP服务器未启用')
        return
      }

      // 确保根目录存在
      try {
        if (!fs.existsSync(this.rootDir)) {
          fs.mkdirSync(this.rootDir, { recursive: true })
        }
      } catch (err) {
        tjLogger.error(`HTTP服务器: 创建根目录失败, error=${err.message}`)
        return
      }

      // 启动时清理过期的临时文件
      this.cleanupExpiredTmpFiles()

      this.server = http.createServer((req, res) => {
        // 设置请求超时
        req.setTimeout(30000, () => {
          tjLogger.warn(`HTTP服务器: 请求超时, 请求路径: ${req.url}`)
          this.sendErrorResponse(res, 408, '请求超时')
        })

        // CDN 兼容
        let clientIp =
          req.headers['x-forwarded-for'] || req.socket.remoteAddress
        if (clientIp.startsWith('::ffff:')) {
          clientIp = clientIp.slice(7)
        }
        tjLogger.debug(
          `HTTP服务器: 收到请求, 请求路径: ${req.url}, clientIp=${clientIp}`,
        )

        try {
          let filePath = path.join(
            this.rootDir,
            req.url === '/' ? 'index.html' : req.url,
          )

          // 规范化路径，以便在 Windows 上进行正确的路径比较
          const normalizedFilePath = path.normalize(filePath)
          const normalizedRootDir = path.normalize(this.rootDir)

          // 安全检查：确保请求的文件在根目录下
          if (!normalizedFilePath.startsWith(normalizedRootDir)) {
            tjLogger.warn(
              `HTTP服务器: 访问被拒绝, 请求路径: ${req.url}, clientIp=${clientIp}`,
            )
            this.sendErrorResponse(res, 403, '访问被拒绝')
            return
          }

          // 在路径检查部分添加调试日志
          tjLogger.debug(
            `HTTP服务器: 路径检查 - 规范化文件路径: ${normalizedFilePath}, 规范化根目录: ${normalizedRootDir}`,
          )

          // 检查文件是否存在
          if (!fs.existsSync(filePath)) {
            tjLogger.warn(
              `HTTP服务器: 文件未找到, 请求路径: ${req.url}, clientIp=${clientIp}`,
            )
            this.sendErrorResponse(res, 404, '文件未找到')
            return
          }

          // 获取文件状态
          fs.stat(filePath, (err, stats) => {
            if (err) {
              tjLogger.warn(
                `HTTP服务器: 获取文件状态失败, 请求路径: ${req.url}, clientIp=${clientIp}, error=${err.message}`,
              )
              this.sendErrorResponse(res, 500, '服务器错误')
              return
            }

            // 根据文件扩展名设置 Content-Type
            const ext = path.extname(filePath)
            const contentTypes = {
              '.html': 'text/html',
              '.css': 'text/css',
              '.js': 'application/javascript',
              '.json': 'application/json',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
              '.pdf': 'application/pdf',
            }
            const contentType = contentTypes[ext] || 'application/octet-stream'

            // 设置响应头
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Length': stats.size,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            })

            // 创建文件流
            const fileStream = fs.createReadStream(filePath, {
              highWaterMark: 64 * 1024, // 64KB chunks
              autoClose: true,
            })

            // 错误处理
            fileStream.on('error', (err) => {
              tjLogger.warn(
                `HTTP服务器: 文件流错误, 请求路径: ${req.url}, clientIp=${clientIp}, error=${err.message}`,
              )
              this.sendErrorResponse(res, 500, '服务器错误')
            })

            // 请求中断处理
            req.on('close', () => {
              fileStream.destroy()
            })

            // 响应中断处理
            res.on('close', () => {
              fileStream.destroy()
            })

            // 开始流式传输
            tjLogger.info(
              `HTTP服务器: 开始流式传输文件, 请求路径: ${req.url}, clientIp=${clientIp}, contentType=${contentType}, size=${stats.size}bytes`,
            )

            // 使用管道传输，并处理错误
            fileStream.pipe(res).on('error', (err) => {
              tjLogger.warn(
                `HTTP服务器: 管道传输错误, 请求路径: ${req.url}, clientIp=${clientIp}, error=${err.message}`,
              )
              if (!res.headersSent) {
                this.sendErrorResponse(res, 500, '服务器错误')
              }
            })
          })
        } catch (err) {
          tjLogger.error(
            `HTTP服务器: 处理请求时发生错误, 请求路径: ${req.url}, clientIp=${clientIp}, error=${err.message}`,
          )
          this.sendErrorResponse(res, 500, '服务器内部错误')
        }
      })

      // 添加服务器错误处理
      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          tjLogger.error(
            `HTTP服务器: 端口 ${serverConfig.listenPort} 已被占用, error=${err.message}`,
          )
        } else {
          tjLogger.error(`HTTP服务器: 发生错误, error=${err.message}`)
        }
      })

      // 添加未捕获异常处理
      this.server.on('uncaughtException', (err) => {
        tjLogger.error(`HTTP服务器: 未捕获的异常, error=${err.message}`)
      })

      // 添加未处理的Promise拒绝处理
      this.server.on('unhandledRejection', (reason, promise) => {
        tjLogger.error(
          `HTTP服务器: 未处理的Promise拒绝, reason=${reason}, promise=${promise.toString()}`,
        )
      })

      this.server.listen(serverConfig.listenPort, () => {
        tjLogger.info(
          `HTTP服务器已启动，监听端口: ${serverConfig.listenPort}, 访问地址: ${serverConfig.accessUrl}`,
        )
      })
    } catch (err) {
      tjLogger.error(`HTTP服务器: 初始化失败, error=${err.message}`)
    }
  }

  cleanupExpiredTmpFiles() {
    const tmpDir = path.join(this.rootDir, 'tmp')
    if (!fs.existsSync(tmpDir)) return

    try {
      const dirs = fs.readdirSync(tmpDir)
      const now = Date.now()

      for (const dir of dirs) {
        const dirPath = path.join(tmpDir, dir)
        const expireFile = path.join(dirPath, '.expire')

        if (fs.existsSync(expireFile)) {
          const expireTime = parseInt(fs.readFileSync(expireFile, 'utf8'))
          if (now > expireTime) {
            try {
              fs.rmSync(dirPath, { recursive: true, force: true })
              tjLogger.debug(`HTTP服务器: 清理过期临时目录, 路径: ${dirPath}`)
            } catch (err) {
              tjLogger.warn(
                `HTTP服务器: 清理过期临时目录失败, 路径: ${dirPath}, error=${err.message}`,
              )
            }
          } else {
            // 文件未过期，重新设置延迟删除
            const delay = expireTime - now
            setTimeout(() => {
              try {
                fs.rmSync(dirPath, { recursive: true, force: true })
                tjLogger.debug(
                  `HTTP服务器: 临时文件已过期删除, 路径: ${dirPath}`,
                )
              } catch (err) {
                tjLogger.warn(
                  `HTTP服务器: 删除过期临时文件失败, 路径: ${dirPath}, error=${err.message}`,
                )
              }
            }, delay)
            tjLogger.debug(
              `HTTP服务器: 重新设置临时文件延迟删除, 路径: ${dirPath}, 剩余时间: ${Math.floor(
                delay / 1000,
              )}秒`,
            )
          }
        }
      }
    } catch (err) {
      tjLogger.warn(`HTTP服务器: 清理临时文件失败, error=${err.message}`)
    }
  }

  /**
   * 创建临时文件链接
   * @param {string} filePath - 文件路径
   * @param {number} expireSeconds - 过期时间（秒）
   * @returns {string} - 临时文件链接
   */
  createTmpFileUrl(filePath, expireSeconds) {
    try {
      // 生成随机目录名
      const randomDir = crypto.randomBytes(8).toString('hex')
      const tmpDir = path.join(this.rootDir, 'tmp', randomDir)

      // 确保临时目录存在
      if (!fs.existsSync(path.join(this.rootDir, 'tmp'))) {
        fs.mkdirSync(path.join(this.rootDir, 'tmp'), { recursive: true })
      }
      fs.mkdirSync(tmpDir, { recursive: true })

      // 复制文件到临时目录
      const fileName = path.basename(filePath)
      const targetPath = path.join(tmpDir, fileName)
      fs.copyFileSync(filePath, targetPath)

      // 创建过期时间标记文件
      const expireTime = Date.now() + expireSeconds * 1000
      fs.writeFileSync(path.join(tmpDir, '.expire'), expireTime.toString())

      // 设置过期删除
      setTimeout(() => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
          tjLogger.debug(`HTTP服务器: 临时文件已过期删除, 路径: ${tmpDir}`)
        } catch (err) {
          tjLogger.warn(
            `HTTP服务器: 删除过期临时文件失败, 路径: ${tmpDir}, error=${err.message}`,
          )
        }
      }, expireSeconds * 1000)

      // 构建访问URL
      const baseUrl = config.getConfig().httpServer.accessUrl
      const url = `${baseUrl}tmp/${randomDir}/${fileName}`

      tjLogger.info(
        `HTTP服务器: 创建临时文件链接, 原始文件: ${filePath}, 临时URL: ${url}, 过期时间: ${expireSeconds}秒`,
      )
      return url
    } catch (err) {
      tjLogger.warn(
        `HTTP服务器: 创建临时文件链接失败, 文件: ${filePath}, error=${err.message}`,
      )
      return null
    }
  }
}

export default new httpServer()
