import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import {
  createReverseGeocoder,
  extractGps,
  formatExifReply,
  formatLocation,
} from '../model/imageExifLocation.js'

const configuredGeocoder = {
  imageExif: { geocodingEndpoint: 'https://geo.example/reverse' },
}

function createLogCollector() {
  const entries = []
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (message) => entries.push({ level, message }),
    ]),
  )
  return { entries, logger }
}

function createGpsJpeg() {
  const tiff = Buffer.alloc(128)
  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(0x8825, 10)
  tiff.writeUInt16LE(4, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt32LE(26, 18)
  tiff.writeUInt32LE(0, 22)

  tiff.writeUInt16LE(4, 26)
  const entries = [
    { tag: 1, type: 2, count: 2, inline: Buffer.from('N\0') },
    { tag: 2, type: 5, count: 3, offset: 80 },
    { tag: 3, type: 2, count: 2, inline: Buffer.from('E\0') },
    { tag: 4, type: 5, count: 3, offset: 104 },
  ]
  entries.forEach((entry, index) => {
    const offset = 28 + index * 12
    tiff.writeUInt16LE(entry.tag, offset)
    tiff.writeUInt16LE(entry.type, offset + 2)
    tiff.writeUInt32LE(entry.count, offset + 4)
    if (entry.inline) entry.inline.copy(tiff, offset + 8)
    else tiff.writeUInt32LE(entry.offset, offset + 8)
  })
  tiff.writeUInt32LE(0, 76)

  const rationals = [
    [80, 31, 1],
    [88, 1, 1],
    [96, 48756, 1000],
    [104, 121, 1],
    [112, 13, 1],
    [120, 4962, 100],
  ]
  for (const [offset, numerator, denominator] of rationals) {
    tiff.writeUInt32LE(numerator, offset)
    tiff.writeUInt32LE(denominator, offset + 4)
  }

  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
  const app1Header = Buffer.alloc(4)
  app1Header.writeUInt16BE(0xffe1, 0)
  app1Header.writeUInt16BE(exif.length + 2, 2)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1Header,
    exif,
    Buffer.from([0xff, 0xd9]),
  ])
}

test('extracts finite GPS coordinates through the EXIF reader', async () => {
  const image = Buffer.from('image')
  const seen = []

  const result = await extractGps(image, {
    gpsReader: async (input) => {
      seen.push(input)
      return { latitude: 31.03021, longitude: 121.23045 }
    },
  })

  assert.deepEqual(result, { latitude: 31.03021, longitude: 121.23045 })
  assert.deepEqual(seen, [image])
})

test('extracts GPS through the real EXIF parser', async () => {
  const result = await extractGps(createGpsJpeg())

  assert.ok(Math.abs(result.latitude - 31.03021) < 0.000001)
  assert.ok(Math.abs(result.longitude - 121.23045) < 0.000001)
})

test('accepts zero-degree coordinates', async () => {
  const result = await extractGps(Buffer.from('image'), {
    gpsReader: async () => ({ latitude: 0, longitude: 0 }),
  })

  assert.deepEqual(result, { latitude: 0, longitude: 0 })
})

test('returns undefined when EXIF GPS is missing or outside valid ranges', async () => {
  for (const gps of [
    undefined,
    {},
    { latitude: Number.NaN, longitude: 121 },
    { latitude: 91, longitude: 121 },
    { latitude: 31, longitude: -181 },
  ]) {
    const result = await extractGps(Buffer.from('image'), {
      gpsReader: async () => gps,
    })
    assert.equal(result, undefined)
  }
})

test('propagates EXIF parser errors for safe workflow logging', async () => {
  await assert.rejects(
    extractGps(Buffer.from('image'), {
      gpsReader: async () => {
        throw new Error('invalid EXIF')
      },
    }),
    /invalid EXIF/u,
  )
})

test('formats municipality addresses without duplicate city names', () => {
  assert.equal(
    formatLocation({
      state: '上海市',
      city: '上海市',
      city_district: '松江区',
      town: '泗泾镇',
    }),
    '上海市松江区泗泾镇',
  )
})

test('formats regular province, city, county and village addresses', () => {
  assert.equal(
    formatLocation({
      province: '浙江省',
      city: '杭州市',
      county: '淳安县',
      village: '里商村',
    }),
    '浙江省杭州市淳安县里商村',
  )
})

test('uses available Nominatim fallbacks and ignores empty address data', () => {
  assert.equal(
    formatLocation({
      region: '北京市',
      municipality: '北京市',
      district: '海淀区',
      suburb: '中关村街道',
    }),
    '北京市海淀区中关村街道',
  )
  assert.equal(
    formatLocation({ country: '中国', postcode: '200000' }),
    undefined,
  )
  assert.equal(formatLocation(undefined), undefined)
})

test('sanitizes and bounds untrusted reverse geocoding fields', () => {
  assert.equal(
    formatLocation({
      state: ' 上海市\n[CQ:at,qq=all]\u202e ',
      city_district: '松江区',
      town: '甲'.repeat(80),
    }),
    `上海市松江区${'甲'.repeat(48)}`,
  )
})

test('formats the requested reply with configurable honorific', () => {
  assert.equal(
    formatExifReply('上海市松江区泗泾镇', '小明', '先生'),
    '请问是上海市松江区泗泾镇的小明 先生吗？',
  )
  assert.equal(
    formatExifReply('上海市松江区泗泾镇', '小明', ''),
    '请问是上海市松江区泗泾镇的小明吗？',
  )
  assert.equal(
    formatExifReply('上海市松江区泗泾镇', '小明', '先生'),
    '请问是上海市松江区泗泾镇的小明 先生吗？',
  )
})

test('reverse geocodes with Nominatim parameters and caches rounded coordinates', async () => {
  const calls = []
  const reverseGeocode = createReverseGeocoder({
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init })
      return {
        ok: true,
        async json() {
          return { address: { state: '上海市', city_district: '松江区' } }
        },
      }
    },
  })
  const config = {
    imageExif: {
      geocodingEndpoint: 'https://geo.example/reverse',
      timeoutMs: 4321,
    },
  }

  const first = await reverseGeocode(
    { latitude: 31.030211, longitude: 121.230451 },
    config,
  )
  const cached = await reverseGeocode(
    { latitude: 31.030214, longitude: 121.230454 },
    config,
  )

  assert.deepEqual(first, { state: '上海市', city_district: '松江区' })
  assert.deepEqual(cached, first)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.origin, 'https://geo.example')
  assert.equal(calls[0].url.pathname, '/reverse')
  assert.equal(calls[0].url.searchParams.get('format'), 'jsonv2')
  assert.equal(calls[0].url.searchParams.get('addressdetails'), '1')
  assert.equal(calls[0].url.searchParams.get('accept-language'), 'zh-CN')
  assert.equal(calls[0].url.searchParams.get('lat'), '31.030211')
  assert.equal(calls[0].url.searchParams.get('lon'), '121.230451')
  assert.match(calls[0].init.headers['User-Agent'], /Yunzai-TomyJan-Plugin/)
  assert.ok(calls[0].init.signal instanceof AbortSignal)
})

test('serializes distinct reverse geocoding requests at least one second apart', async () => {
  let clock = 10_000
  const sleeps = []
  const reverseGeocode = createReverseGeocoder({
    now: () => clock,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      clock += milliseconds
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ address: { town: '泗泾镇' } }),
    }),
  })

  await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder)
  clock += 125
  await reverseGeocode({ latitude: 32, longitude: 121 }, configuredGeocoder)

  assert.deepEqual(sleeps, [875])
})

test('uses the shared proxy only when the EXIF feature enables it', async () => {
  const requests = []
  const created = []
  const reverseGeocode = createReverseGeocoder({
    proxyAgentFactory: (url) => {
      created.push(url)
      return { proxyUrl: url }
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return { ok: true, json: async () => ({ address: { town: '泗泾镇' } }) }
    },
  })
  const config = {
    proxy: { url: 'http://127.0.0.1:7890' },
    imageExif: {
      geocodingEndpoint: 'https://geo.example/reverse',
      proxy: { enable: true },
    },
  }

  await reverseGeocode({ latitude: 31, longitude: 121 }, config)

  assert.deepEqual(created, ['http://127.0.0.1:7890'])
  assert.deepEqual(requests[0].init.dispatcher, {
    proxyUrl: 'http://127.0.0.1:7890',
  })
})

test('uses the shared proxy for Amap requests', async () => {
  const requests = []
  const reverseGeocode = createReverseGeocoder({
    proxyAgentFactory: (url) => ({ proxyUrl: url }),
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init })
      return {
        ok: true,
        json: async () => ({
          status: '1',
          regeocode: { addressComponent: { township: '泗泾镇' } },
        }),
      }
    },
  })

  await reverseGeocode(
    { latitude: 31, longitude: 121 },
    {
      proxy: { url: 'http://127.0.0.1:7890' },
      imageExif: {
        provider: 'amap',
        amap: { apiKeys: ['key'] },
        proxy: { enable: true },
      },
    },
  )

  assert.equal(requests[0].url.origin, 'https://restapi.amap.com')
  assert.deepEqual(requests[0].init.dispatcher, {
    proxyUrl: 'http://127.0.0.1:7890',
  })
})

test('rejects insecure endpoints and treats remote failures as unavailable', async () => {
  let calls = 0
  const reverseGeocode = createReverseGeocoder({
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1
      return { ok: false, status: 429, json: async () => ({}) }
    },
  })

  assert.equal(
    await reverseGeocode(
      { latitude: 31, longitude: 121 },
      { imageExif: { geocodingEndpoint: 'http://geo.example/reverse' } },
    ),
    undefined,
  )
  assert.equal(calls, 0)
  assert.equal(
    await reverseGeocode({ latitude: 32, longitude: 121 }, configuredGeocoder),
    undefined,
  )
  assert.equal(calls, 1)
})

test('rejects invalid coordinates and malformed endpoints before fetching', async () => {
  let calls = 0
  const reverseGeocode = createReverseGeocoder({
    fetchImpl: async () => {
      calls += 1
    },
  })

  assert.equal(
    await reverseGeocode({ latitude: 91, longitude: 121 }, configuredGeocoder),
    undefined,
  )
  assert.equal(
    await reverseGeocode(
      { latitude: 31, longitude: 121 },
      { imageExif: { geocodingEndpoint: 'not a URL' } },
    ),
    undefined,
  )
  assert.equal(calls, 0)
})

test('uses the public Nominatim reverse API by default', async () => {
  const calls = []
  const reverseGeocode = createReverseGeocoder({
    fetchImpl: async (url) => {
      calls.push(new URL(url))
      return {
        ok: true,
        json: async () => ({ address: { state: '上海市' } }),
      }
    },
  })

  assert.deepEqual(
    await reverseGeocode(
      { latitude: 31, longitude: 121 },
      { imageExif: { provider: 'nominatim' } },
    ),
    { state: '上海市' },
  )
  assert.equal(calls[0].origin, 'https://nominatim.openstreetmap.org')
  assert.equal(calls[0].pathname, '/reverse')
})

test('reverse geocodes through Amap with GPS coordinates', async () => {
  const calls = []
  const reverseGeocode = createReverseGeocoder({
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: '1',
          regeocode: {
            addressComponent: {
              province: '上海市',
              city: [],
              district: '松江区',
              township: '泗泾镇',
            },
          },
        }),
      }
    },
  })

  const result = await reverseGeocode(
    { latitude: 31.03021, longitude: 121.23045 },
    {
      imageExif: {
        provider: 'amap',
        amap: { apiKeys: ['amap-key'] },
      },
    },
  )

  assert.deepEqual(result, {
    province: '上海市',
    city: undefined,
    district: '松江区',
    town: '泗泾镇',
  })
  assert.equal(calls[0].url.origin, 'https://restapi.amap.com')
  assert.equal(calls[0].url.pathname, '/v3/geocode/regeo')
  assert.equal(calls[0].url.searchParams.get('key'), 'amap-key')
  const [longitude, latitude] = calls[0].url.searchParams
    .get('location')
    .split(',')
    .map(Number)
  assert.ok(Math.abs(longitude - 121.234865) < 0.000001)
  assert.ok(Math.abs(latitude - 31.028088) < 0.000001)
  assert.equal(calls[0].url.searchParams.has('coordsys'), false)
  assert.equal(calls[0].url.searchParams.get('output'), 'json')
  assert.equal(calls[0].url.searchParams.get('extensions'), 'base')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
})

test('rotates Amap keys on retryable failures and redacts graded logs', async () => {
  const requestedKeys = []
  const { entries, logger } = createLogCollector()
  const reverseGeocode = createReverseGeocoder({
    logger,
    fetchImpl: async (url) => {
      requestedKeys.push(new URL(url).searchParams.get('key'))
      if (requestedKeys.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: '0', infocode: '10003' }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: '1',
          regeocode: {
            addressComponent: {
              province: '上海市',
              district: '松江区',
              township: '泗泾镇',
            },
          },
        }),
      }
    },
  })

  const result = await reverseGeocode(
    { latitude: 31.03021, longitude: 121.23045 },
    {
      imageExif: {
        provider: 'amap',
        amap: { apiKeys: ['secret-one', 'secret-two'] },
      },
    },
  )

  assert.equal(result.town, '泗泾镇')
  assert.deepEqual(requestedKeys, ['secret-one', 'secret-two'])
  assert.ok(entries.some((entry) => entry.level === 'debug'))
  assert.ok(entries.some((entry) => entry.level === 'info'))
  assert.ok(entries.some((entry) => entry.level === 'warn'))
  const logText = entries.map((entry) => entry.message).join('\n')
  assert.doesNotMatch(
    logText,
    /secret-one|secret-two|31\.03021|121\.23045|泗泾镇/u,
  )
})

test('skips Amap without keys and logs a safe warning', async () => {
  let calls = 0
  const { entries, logger } = createLogCollector()
  const reverseGeocode = createReverseGeocoder({
    logger,
    fetchImpl: async () => {
      calls += 1
    },
  })

  assert.equal(
    await reverseGeocode(
      { latitude: 31, longitude: 121 },
      { imageExif: { provider: 'amap', amap: { apiKeys: [] } } },
    ),
    undefined,
  )
  assert.equal(calls, 0)
  assert.ok(entries.some((entry) => entry.level === 'warn'))
})

test('bounds external Amap codes and exception types in logs', async () => {
  const { entries, logger } = createLogCollector()
  const responses = [
    {
      ok: true,
      status: 200,
      json: async () => ({ status: '0', infocode: '10003\nsecret-log' }),
    },
  ]
  const reverseGeocode = createReverseGeocoder({
    logger,
    fetchImpl: async () => {
      const response = responses.shift()
      if (response) return response
      const error = new Error('network')
      error.name = 'Injected\nsecret-type'
      throw error
    },
  })
  const config = {
    imageExif: {
      provider: 'amap',
      amap: { apiKeys: ['first', 'second'] },
    },
  }

  await reverseGeocode({ latitude: 31, longitude: 121 }, config)
  await reverseGeocode(
    { latitude: 32, longitude: 121 },
    {
      imageExif: {
        provider: 'amap',
        amap: { apiKeys: ['third'] },
      },
    },
  )
  const logText = entries.map((entry) => entry.message).join('\n')

  assert.doesNotMatch(logText, /secret-log|secret-type|Injected/u)
  assert.match(logText, /高德返回了无法识别的错误码/u)
  assert.match(logText, /高德请求失败：未知网络错误/u)
  assert.doesNotMatch(logText, /\b(?:provider|request|apiCode|type)=/u)
})

test('describes safe Nominatim network causes in natural language', async () => {
  const { entries, logger } = createLogCollector()
  const error = new TypeError('fetch failed: secret endpoint')
  error.cause = Object.assign(new Error('connect timeout: secret proxy'), {
    code: 'UND_ERR_CONNECT_TIMEOUT',
  })
  const reverseGeocode = createReverseGeocoder({
    logger,
    fetchImpl: async () => {
      throw error
    },
  })

  await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder)
  const logText = entries.map((entry) => entry.message).join('\n')

  assert.match(logText, /Nominatim 请求失败：连接超时/u)
  assert.doesNotMatch(logText, /secret|provider=|request=|type=/u)
})

test('uses the default delay when requests arrive too quickly', async () => {
  const reverseGeocode = createReverseGeocoder({
    now: () => 0,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ address: { town: '泗泾镇' } }),
    }),
  })

  await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder)
  const startedAt = Date.now()
  await reverseGeocode({ latitude: 32, longitude: 121 }, configuredGeocoder)

  assert.ok(Date.now() - startedAt >= 900)
})

test('bounds the successful coordinate cache to 500 entries', async () => {
  let calls = 0
  const reverseGeocode = createReverseGeocoder({
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1
      return {
        ok: true,
        json: async () => ({ address: { town: '泗泾镇' } }),
      }
    },
  })

  for (let index = 0; index <= 500; index += 1) {
    await reverseGeocode(
      { latitude: index / 10, longitude: 121 },
      configuredGeocoder,
    )
  }
  await reverseGeocode({ latitude: 0, longitude: 121 }, configuredGeocoder)

  assert.equal(calls, 502)
})

test('expires cached locations after one hour', async () => {
  let clock = 0
  let calls = 0
  const reverseGeocode = createReverseGeocoder({
    now: () => clock,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1
      return {
        ok: true,
        json: async () => ({ address: { town: '泗泾镇' } }),
      }
    },
  })

  await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder)
  clock = 60 * 60 * 1000 + 1
  await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder)

  assert.equal(calls, 2)
})

test('actively releases cached location data after one hour of inactivity', async () => {
  let scheduled
  let calls = 0
  const reverseGeocode = createReverseGeocoder({
    now: () => 0,
    sleep: async () => {},
    setTimeoutImpl: (callback, milliseconds) => {
      scheduled = { callback, milliseconds, unrefed: false }
      return {
        unref() {
          scheduled.unrefed = true
        },
      }
    },
    clearTimeoutImpl: () => {},
    fetchImpl: async () => {
      calls += 1
      return {
        ok: true,
        json: async () => ({ address: { town: '泗泾镇' } }),
      }
    },
  })

  await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder)
  assert.equal(scheduled.milliseconds, 60 * 60 * 1000)
  assert.equal(scheduled.unrefed, true)
  scheduled.callback()
  await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder)

  assert.equal(calls, 2)
})

test('rejects geocoding work beyond 20 pending requests', async () => {
  let releaseFirst
  const firstRequest = new Promise((resolve) => {
    releaseFirst = resolve
  })
  let calls = 0
  const reverseGeocode = createReverseGeocoder({
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) await firstRequest
      return {
        ok: true,
        json: async () => ({ address: { town: '泗泾镇' } }),
      }
    },
  })
  const requests = Array.from({ length: 21 }, (_, index) =>
    reverseGeocode(
      { latitude: index / 10, longitude: 121 },
      configuredGeocoder,
    ),
  )

  assert.equal(await requests[20], undefined)
  releaseFirst()
  const results = await Promise.all(requests.slice(0, 20))

  assert.equal(results.filter(Boolean).length, 20)
})

test('treats invalid JSON and fetch errors as unavailable', async () => {
  const responses = [
    { ok: true, json: async () => ({ address: 'invalid' }) },
    { ok: true, json: async () => Promise.reject(new Error('bad json')) },
  ]
  const reverseGeocode = createReverseGeocoder({
    sleep: async () => {},
    fetchImpl: async () => {
      const response = responses.shift()
      if (response) return response
      throw new Error('network down')
    },
  })

  assert.equal(
    await reverseGeocode({ latitude: 31, longitude: 121 }, configuredGeocoder),
    undefined,
  )
  assert.equal(
    await reverseGeocode({ latitude: 32, longitude: 121 }, configuredGeocoder),
    undefined,
  )
  assert.equal(
    await reverseGeocode({ latitude: 33, longitude: 121 }, configuredGeocoder),
    undefined,
  )
})
