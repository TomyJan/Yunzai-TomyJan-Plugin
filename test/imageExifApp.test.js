import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import test from 'node:test'

import { processImageExifEvent } from '../model/imageExifMessage.js'

const appSource = fs.readFileSync(
  new URL('../apps/imageExif.js', import.meta.url),
  'utf8',
)

function privateImageEvent(overrides = {}) {
  return {
    isPrivate: true,
    user_id: 10001,
    sender: { nickname: '小明' },
    message: [
      { type: 'image', url: 'https://image.example/first.jpg' },
      { type: 'image', url: 'https://image.example/second.jpg' },
    ],
    ...overrides,
  }
}

test('registers a low-priority message listener and delegates to the model workflow', () => {
  assert.match(appSource, /event:\s*'message'/)
  assert.match(appSource, /priority:\s*9999/)
  assert.match(appSource, /reg:\s*'\.\*'/)
  assert.match(appSource, /processImageExifEvent\(/)
  for (const level of ['debug', 'info', 'warn', 'error']) {
    assert.match(appSource, new RegExp(`tjLogger\\.${level}`))
  }
})

test('logs image processing in natural language without sensitive values', async () => {
  const logs = []
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (message) => logs.push({ level, message }),
    ]),
  )
  const result = await processImageExifEvent(
    privateImageEvent(),
    { imageExif: { enable: true, provider: 'nominatim' } },
    {
      logger,
      downloadImage: async () => ({ buffer: Buffer.from('jpeg') }),
      extractGps: async () => undefined,
    },
  )

  assert.deepEqual(result, { status: 'skipped', reason: 'no_gps' })
  assert.ok(logs.some((entry) => entry.level === 'info'))
  assert.ok(logs.some((entry) => entry.level === 'debug'))
  const logText = logs.map((entry) => entry.message).join('\n')
  assert.match(logText, /开始处理图片定位/u)
  assert.match(logText, /图片下载完成/u)
  assert.match(logText, /没有可用的 GPS 信息/u)
  assert.doesNotMatch(logText, /\b(?:provider|workflow|stage|status|reason)=/u)
  assert.doesNotMatch(logText, /first\.jpg|小明|10001/u)
})

test('does not append provider attribution to replies', async () => {
  const result = await processImageExifEvent(
    privateImageEvent(),
    {
      imageExif: { enable: true, provider: 'amap', amap: { apiKeys: ['key'] } },
    },
    {
      downloadImage: async () => ({ buffer: Buffer.from('jpeg') }),
      extractGps: async () => ({ latitude: 31, longitude: 121 }),
      reverseGeocode: async () => ({ province: '上海市', district: '松江区' }),
    },
  )

  assert.equal(result.message, '请问是上海市松江区的小明 先生吗？')
})

test('processes all chat scopes when enabled and skips imageless events', async () => {
  let downloads = 0
  const dependencies = {
    downloadImage: async () => {
      downloads += 1
    },
  }

  assert.deepEqual(
    await processImageExifEvent(privateImageEvent(), {}, dependencies),
    { status: 'skipped', reason: 'disabled' },
  )
  await processImageExifEvent(
    privateImageEvent({ isPrivate: false, isGroup: true, group_id: 123456 }),
    { imageExif: { enable: true } },
    {
      ...dependencies,
      downloadImage: async () => {
        downloads += 1
        return { buffer: Buffer.from('jpeg'), mimeType: 'image/jpeg' }
      },
      extractGps: async () => undefined,
    },
  )
  assert.deepEqual(
    await processImageExifEvent(
      privateImageEvent({ message: [{ type: 'text', text: 'hello' }] }),
      { imageExif: { enable: true } },
      dependencies,
    ),
    { status: 'skipped', reason: 'no_image' },
  )
  assert.equal(downloads, 1)
})

test('resolves HEIC file messages through get_file without trusting message paths', async () => {
  const image = Buffer.from('heic-image')
  const apiCalls = []
  let downloaded = false
  const result = await processImageExifEvent(
    privateImageEvent({
      message: [
        {
          type: 'file',
          data: {
            file: 'C:\\untrusted\\IMG_0001.HEIC',
            file_id: 'napcat-file-id',
            file_name: 'IMG_0001.HEIC',
          },
        },
      ],
      bot: {
        sendApi: async (action, payload) => {
          apiCalls.push({ action, payload })
          return {
            data: {
              file: 'C:\\trusted-cache\\IMG_0001.HEIC',
              file_name: 'IMG_0001.HEIC',
              file_size: image.length,
            },
          }
        },
      },
    }),
    { imageExif: { enable: true } },
    {
      downloadImage: async () => {
        downloaded = true
      },
      readFile: async (filePath) => {
        assert.equal(filePath, 'C:\\trusted-cache\\IMG_0001.HEIC')
        return image
      },
      statFile: async () => ({ size: image.length, isFile: () => true }),
      extractGps: async (buffer) => {
        assert.equal(buffer, image)
        return undefined
      },
    },
  )

  assert.deepEqual(apiCalls, [
    { action: 'get_file', payload: { file_id: 'napcat-file-id' } },
  ])
  assert.equal(downloaded, false)
  assert.deepEqual(result, { status: 'skipped', reason: 'no_gps' })
})

test('downloads the remote URL returned by get_file for HEIF files', async () => {
  const calls = []
  const result = await processImageExifEvent(
    privateImageEvent({
      message: [
        {
          type: 'file',
          data: { file_name: 'camera.heif', file_id: 'remote-file-id' },
        },
      ],
      bot: {
        sendApi: async () => ({
          data: { data: { url: 'https://files.example/download?id=123' } },
        }),
      },
    }),
    { imageExif: { enable: true } },
    {
      downloadImage: async (url, options) => {
        calls.push({ url, options })
        return { buffer: Buffer.from('heif'), mimeType: 'image/heif' }
      },
      extractGps: async () => undefined,
    },
  )

  assert.equal(calls[0].url, 'https://files.example/download?id=123')
  assert.ok(calls[0].options.allowedMimeTypes.includes('image/heif'))
  assert.equal(calls[0].options.mimeTypeHint, 'image/heif')
  assert.deepEqual(result, { status: 'skipped', reason: 'no_gps' })
})

test('supports OneBot file segments that use file as an opaque file ID', async () => {
  const apiCalls = []
  const result = await processImageExifEvent(
    privateImageEvent({
      message: [
        {
          type: 'file',
          data: { name: 'camera.heic', file: 'opaque-onebot-file-id' },
        },
      ],
      bot: {
        sendApi: async (action, payload) => {
          apiCalls.push({ action, payload })
          return { data: { file: 'C:\\cache\\camera.heic' } }
        },
      },
    }),
    { imageExif: { enable: true } },
    {
      statFile: async () => ({ size: 4, isFile: () => true }),
      readFile: async () => Buffer.from('heic'),
      extractGps: async () => undefined,
    },
  )

  assert.deepEqual(apiCalls, [
    { action: 'get_file', payload: { file_id: 'opaque-onebot-file-id' } },
  ])
  assert.deepEqual(result, { status: 'skipped', reason: 'no_gps' })
})

test('times out a stalled get_file request and releases the workflow', async () => {
  const event = privateImageEvent({
    message: [
      {
        type: 'file',
        data: { file_name: 'camera.heic', file_id: 'stalled-file-id' },
      },
    ],
    bot: { sendApi: async () => new Promise(() => {}) },
  })
  const config = { imageExif: { enable: true, timeoutMs: 10 } }

  const first = await processImageExifEvent(event, config)
  const second = await processImageExifEvent(privateImageEvent(), config, {
    downloadImage: async () => ({
      buffer: Buffer.from('jpeg'),
      mimeType: 'image/jpeg',
    }),
    extractGps: async () => undefined,
  })

  assert.deepEqual(first, { status: 'error', stage: 'download' })
  assert.deepEqual(second, { status: 'skipped', reason: 'no_gps' })
})

test('times out a stalled local HEIC read and releases the workflow', async () => {
  const event = privateImageEvent({
    message: [
      {
        type: 'file',
        data: { file_name: 'camera.heic', file_id: 'cached-file-id' },
      },
    ],
    bot: {
      sendApi: async () => ({ data: { file: 'C:\\cache\\camera.heic' } }),
    },
  })
  const config = { imageExif: { enable: true, timeoutMs: 10 } }

  const result = await processImageExifEvent(event, config, {
    statFile: async () => ({ size: 4, isFile: () => true }),
    readFile: async () => new Promise(() => {}),
  })

  assert.deepEqual(result, { status: 'error', stage: 'download' })
})

test('rejects oversized local HEIC files before reading their contents', async () => {
  let read = false
  const result = await processImageExifEvent(
    privateImageEvent({
      message: [
        {
          type: 'file',
          data: { file_name: 'large.heic', file_id: 'large-file-id' },
        },
      ],
      bot: {
        sendApi: async () => ({ data: { file: 'C:\\cache\\large.heic' } }),
      },
    }),
    { imageExif: { enable: true, maxFileSize: 1024 } },
    {
      statFile: async () => ({ size: 1025, isFile: () => true }),
      readFile: async () => {
        read = true
        return Buffer.alloc(1025)
      },
    },
  )

  assert.equal(read, false)
  assert.deepEqual(result, { status: 'error', stage: 'download' })
})

test('downloads HEIF file URLs with explicit EXIF-only MIME support', async () => {
  const calls = []
  await processImageExifEvent(
    privateImageEvent({
      message: [
        {
          type: 'file',
          data: {
            file_name: 'camera.heif',
            url: 'https://files.example/camera.heif',
          },
        },
      ],
    }),
    { imageExif: { enable: true } },
    {
      downloadImage: async (url, options) => {
        calls.push({ url, options })
        return { buffer: Buffer.from('heif'), mimeType: 'image/heif' }
      },
      extractGps: async () => undefined,
    },
  )

  assert.equal(calls[0].url, 'https://files.example/camera.heif')
  assert.deepEqual(calls[0].options.allowedMimeTypes, [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'image/heif',
  ])
})

test('downloads only the first image and produces the requested reply', async () => {
  const downloaded = []
  const image = Buffer.from('jpeg')
  const result = await processImageExifEvent(
    privateImageEvent({ sender: { card: '群名片', nickname: '昵称' } }),
    {
      imageExif: {
        enable: true,
        honorific: '先生',
        attribution: '位置服务商',
      },
    },
    {
      downloadImage: async (url, options) => {
        downloaded.push({ url, options })
        return { buffer: image, mimeType: 'image/jpeg' }
      },
      extractGps: async (buffer) => {
        assert.equal(buffer, image)
        return { latitude: 31.03, longitude: 121.23 }
      },
      reverseGeocode: async (gps) => {
        assert.deepEqual(gps, { latitude: 31.03, longitude: 121.23 })
        return {
          state: '上海市',
          city: '上海市',
          city_district: '松江区',
          town: '泗泾镇',
        }
      },
    },
  )

  assert.equal(downloaded.length, 1)
  assert.equal(downloaded[0].url, 'https://image.example/first.jpg')
  assert.equal(downloaded[0].options.timeoutMs, 10000)
  assert.equal(downloaded[0].options.maxFileSize, 20 * 1024 * 1024)
  assert.deepEqual(result, {
    status: 'reply',
    message: '请问是上海市松江区泗泾镇的群名片 先生吗？',
  })
})

test('supports Yunzai events that expose image URLs through e.img', async () => {
  const downloaded = []
  const result = await processImageExifEvent(
    privateImageEvent({
      message: [{ type: 'text', text: '' }],
      img: ['https://image.example/yunzai.jpg'],
    }),
    { imageExif: { enable: true } },
    {
      downloadImage: async (url) => {
        downloaded.push(url)
        return { buffer: Buffer.from('jpeg') }
      },
      extractGps: async () => undefined,
    },
  )

  assert.deepEqual(downloaded, ['https://image.example/yunzai.jpg'])
  assert.deepEqual(result, { status: 'skipped', reason: 'no_gps' })
})

test('falls back to e.img when an image segment only has a local file path', async () => {
  const downloaded = []
  await processImageExifEvent(
    privateImageEvent({
      message: [{ type: 'image', file: 'C:\\images\\local.jpg' }],
      img: ['https://image.example/public.jpg'],
    }),
    { imageExif: { enable: true } },
    {
      downloadImage: async (url) => {
        downloaded.push(url)
        return { buffer: Buffer.from('jpeg') }
      },
      extractGps: async () => undefined,
    },
  )

  assert.deepEqual(downloaded, ['https://image.example/public.jpg'])
})

test('silently skips images without GPS or a usable address', async () => {
  let reverseCalls = 0
  const noGps = await processImageExifEvent(
    privateImageEvent(),
    { imageExif: { enable: true } },
    {
      downloadImage: async () => ({ buffer: Buffer.from('jpeg') }),
      extractGps: async () => undefined,
      reverseGeocode: async () => {
        reverseCalls += 1
      },
    },
  )
  assert.deepEqual(noGps, { status: 'skipped', reason: 'no_gps' })
  assert.equal(reverseCalls, 0)

  const noAddress = await processImageExifEvent(
    privateImageEvent(),
    { imageExif: { enable: true } },
    {
      downloadImage: async () => ({ buffer: Buffer.from('jpeg') }),
      extractGps: async () => ({ latitude: 31, longitude: 121 }),
      reverseGeocode: async () => ({ country: '中国' }),
    },
  )
  assert.deepEqual(noAddress, {
    status: 'skipped',
    reason: 'no_location',
  })
})

test('returns only a safe processing stage when a dependency fails', async () => {
  const result = await processImageExifEvent(
    privateImageEvent(),
    { imageExif: { enable: true } },
    {
      downloadImage: async () => {
        throw new Error(
          'https://secret.example/image.jpg?token=private 31.0300,121.2300',
        )
      },
    },
  )

  assert.deepEqual(result, { status: 'error', stage: 'download' })
  assert.doesNotMatch(JSON.stringify(result), /secret|31\.0300|121\.2300/)
})

test('reports safe EXIF and geocoding stages without original errors', async () => {
  const common = {
    downloadImage: async () => ({ buffer: Buffer.from('jpeg') }),
  }
  const exifResult = await processImageExifEvent(
    privateImageEvent(),
    { imageExif: { enable: true } },
    {
      ...common,
      extractGps: async () => {
        throw new Error('private EXIF data')
      },
    },
  )
  const geocodeResult = await processImageExifEvent(
    privateImageEvent(),
    { imageExif: { enable: true } },
    {
      ...common,
      extractGps: async () => ({ latitude: 31, longitude: 121 }),
      reverseGeocode: async () => {
        throw new Error('private location data')
      },
    },
  )

  assert.deepEqual(exifResult, { status: 'error', stage: 'exif' })
  assert.deepEqual(geocodeResult, { status: 'error', stage: 'geocode' })
})

test('bounds configured download limits and falls back from invalid values', async () => {
  const options = []
  await processImageExifEvent(
    privateImageEvent(),
    {
      imageExif: {
        enable: true,
        timeoutMs: 120000,
        maxFileSize: 'invalid',
      },
    },
    {
      downloadImage: async (url, value) => {
        options.push(value)
        return { buffer: Buffer.from('jpeg') }
      },
      extractGps: async () => undefined,
    },
  )

  assert.deepEqual(options, [
    { timeoutMs: 60000, maxFileSize: 20 * 1024 * 1024 },
  ])
})

test('limits the complete image workflow to two concurrent jobs', async () => {
  const releases = []
  let downloads = 0
  const dependencies = {
    downloadImage: async () => {
      downloads += 1
      await new Promise((resolve) => releases.push(resolve))
      return { buffer: Buffer.from('jpeg') }
    },
    extractGps: async () => undefined,
  }
  const config = { imageExif: { enable: true } }

  const first = processImageExifEvent(privateImageEvent(), config, dependencies)
  const second = processImageExifEvent(
    privateImageEvent(),
    config,
    dependencies,
  )
  const third = await processImageExifEvent(
    privateImageEvent(),
    config,
    dependencies,
  )

  assert.equal(downloads, 2)
  assert.deepEqual(third, { status: 'skipped', reason: 'busy' })
  releases.forEach((release) => release())
  await Promise.all([first, second])
})
