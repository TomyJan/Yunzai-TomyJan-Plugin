import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { downloadImage, inspectAiImage } from '../model/aiImage.js'

function createMemoryLogger() {
  const entries = []
  return {
    entries,
    debug: (...parts) => entries.push(['debug', parts.join(' ')]),
    info: (...parts) => entries.push(['info', parts.join(' ')]),
    warn: (...parts) => entries.push(['warn', parts.join(' ')]),
    error: (...parts) => entries.push(['error', parts.join(' ')]),
  }
}

test('downloads once and isolates provider failures during inspection', async () => {
  let downloads = 0
  const result = await inspectAiImage(
    'https://example.test/image.png',
    {
      timeoutMs: 1000,
      maxFileSize: 1024,
      proxy: { url: '' },
      aiImage: {
        proxy: { enable: false },
        c2pa: { enable: true },
        openai: { enable: false },
        hive: { enable: true, apiKeys: ['hive-key'] },
        sightengine: { enable: false },
      },
    },
    {
      downloadImpl: async () => {
        downloads += 1
        return { buffer: Buffer.from('image'), mimeType: 'image/png' }
      },
      readerFactory: async () => ({
        getActive: () => ({
          validation_state: 'trusted',
          issuer: 'Test issuer',
          digital_source_type:
            'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
        }),
      }),
      fetchImpl: async () => {
        throw new Error('provider timeout')
      },
    },
  )

  assert.equal(downloads, 1)
  assert.equal(result.verdict, 'detected')
  assert.match(result.message, /C2PA/)
  assert.equal(
    result.results.find(({ provider }) => provider === 'hive').status,
    'error',
  )
})

test('skips image download when every inspection provider is disabled', async () => {
  let downloadCalls = 0
  const result = await inspectAiImage(
    'https://public.example/image.png',
    {
      aiImage: {
        c2pa: { enable: false },
        openai: { enable: false },
        hive: { enable: false },
        sightengine: { enable: false },
      },
    },
    {
      downloadImpl: async () => {
        downloadCalls += 1
        return { buffer: Buffer.from('image'), mimeType: 'image/png' }
      },
    },
  )

  assert.equal(downloadCalls, 0)
  assert.equal(result.verdict, 'unknown')
  assert.match(result.message, /未启用任何检测渠道/)
})

test('runs every enabled provider instead of treating providers as fallbacks', async () => {
  const calls = []
  const result = await inspectAiImage(
    'https://example.test/image.png',
    {
      aiImage: {
        c2pa: { enable: true },
        openai: { enable: true, apiKeys: ['openai-key'] },
        hive: { enable: true, apiKeys: ['hive-key'] },
        sightengine: {
          enable: true,
          credentials: [{ apiUser: 'user', apiSecret: 'secret' }],
        },
      },
    },
    {
      downloadImpl: async () => ({
        buffer: Buffer.from('image'),
        mimeType: 'image/png',
      }),
      readerFactory: async () => {
        calls.push('c2pa')
        return { getActive: () => null }
      },
      fetchImpl: async (url) => {
        const value = String(url)
        if (value.includes('openai.com')) {
          calls.push('openai')
          return new Response(
            JSON.stringify({
              results: [{ type: 'synthid', outcome: 'not_detected' }],
            }),
          )
        }
        if (value.includes('thehive.ai')) {
          calls.push('hive')
          return new Response(JSON.stringify({ ai_generated: 0.1 }))
        }
        calls.push('sightengine')
        return new Response(JSON.stringify({ type: { ai_generated: 0.1 } }))
      },
    },
  )

  assert.deepEqual(
    new Set(calls),
    new Set(['c2pa', 'openai', 'hive', 'sightengine']),
  )
  assert.deepEqual(
    result.results.map(({ provider }) => provider),
    ['c2pa', 'openai', 'hive', 'sightengine'],
  )
})

test('rejects unsupported image content before providers run', async () => {
  await assert.rejects(
    inspectAiImage(
      'https://example.test/image.gif',
      {},
      {
        downloadImpl: async () => ({
          buffer: Buffer.from('image'),
          mimeType: 'image/gif',
        }),
      },
    ),
    /PNG、JPEG、WebP/,
  )
})

test('rejects private image URLs before making a request', async () => {
  let requested = false
  await assert.rejects(
    inspectAiImage(
      'http://127.0.0.1/image.png',
      {},
      {
        fetchImpl: async () => {
          requested = true
          throw new Error('should not request')
        },
      },
    ),
    /内网地址/,
  )
  assert.equal(requested, false)
})

test('rejects non-public and IPv4-mapped image addresses', async () => {
  for (const url of [
    'http://100.64.0.1/image.png',
    'http://[fe90::1]/image.png',
    'http://[::ffff:127.0.0.1]/image.png',
  ]) {
    let requested = false
    await assert.rejects(
      downloadImage(url, {
        fetchImpl: async () => {
          requested = true
          return new Response()
        },
      }),
      /内网地址/,
    )
    assert.equal(requested, false)
  }
})

test('aborts a streamed image when it exceeds the configured size', async () => {
  let cancelled = false
  const body = {
    getReader() {
      return {
        async read() {
          return { done: false, value: new Uint8Array(10) }
        },
        async cancel() {
          cancelled = true
        },
        releaseLock() {},
      }
    },
  }
  await assert.rejects(
    downloadImage('https://example.com/image.png', {
      maxFileSize: 5,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name) => (name === 'content-type' ? 'image/png' : null),
        },
        body,
      }),
    }),
    /图片超过大小限制/,
  )
  assert.equal(cancelled, true)
})

test('validates every redirect target before following it', async () => {
  let requests = 0
  await assert.rejects(
    downloadImage('https://public.example/image.png', {
      resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
      fetchImpl: async () => {
        requests += 1
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name) =>
              name === 'location' ? 'http://127.0.0.1/private.png' : null,
          },
        }
      },
    }),
    /内网地址/,
  )
  assert.equal(requests, 1)
})

test('shares one proxy switch across download and external providers', async () => {
  const dispatchers = []
  const proxyAgentFactory = (url) => ({ proxyUrl: url })
  const pluginConfig = {
    proxy: { url: 'http://proxy.example:8080' },
    aiImage: {
      proxy: { enable: true },
      c2pa: { enable: false },
      openai: { enable: true, apiKeys: ['openai-key'] },
      hive: { enable: true, apiKeys: ['hive-key'] },
      sightengine: {
        enable: true,
        credentials: [{ apiUser: 'user', apiSecret: 'secret' }],
      },
    },
  }

  await inspectAiImage('https://public.example/image.png', pluginConfig, {
    resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
    proxyAgentFactory,
    fetchImpl: async (url, init) => {
      dispatchers.push({ url: String(url), dispatcher: init.dispatcher })
      if (String(url).includes('public.example')) {
        return new Response(Buffer.from('image'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      if (String(url).includes('openai.com')) {
        return new Response(
          JSON.stringify({
            results: [{ type: 'synthid', outcome: 'not_detected' }],
          }),
        )
      }
      if (String(url).includes('thehive.ai')) {
        return new Response(JSON.stringify({ ai_generated: 0.1 }))
      }
      return new Response(JSON.stringify({ type: { ai_generated: 0.1 } }))
    },
  })

  assert.equal(dispatchers.length, 4)
  assert.deepEqual(
    dispatchers.map(({ dispatcher }) => dispatcher),
    Array(4).fill({ proxyUrl: 'http://proxy.example:8080' }),
  )
})

test('keeps download and providers direct when the AI image proxy switch is off', async () => {
  const dispatchers = []
  await inspectAiImage(
    'https://public.example/image.png',
    {
      proxy: { url: 'http://proxy.example:8080' },
      aiImage: {
        proxy: { enable: false },
        c2pa: { enable: false },
        openai: { enable: true, apiKeys: ['key'] },
        hive: { enable: false },
        sightengine: { enable: false },
      },
    },
    {
      resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
      fetchImpl: async (url, init) => {
        dispatchers.push(init.dispatcher)
        if (String(url).includes('public.example')) {
          return new Response(Buffer.from('image'), {
            headers: { 'content-type': 'image/png' },
          })
        }
        return new Response(
          JSON.stringify({
            results: [{ type: 'synthid', outcome: 'not_detected' }],
          }),
        )
      },
    },
  )

  assert.deepEqual(dispatchers, [undefined, undefined])
})

test('never creates a proxy dispatcher for local C2PA inspection', async () => {
  let proxyFactories = 0
  await inspectAiImage(
    'https://public.example/image.png',
    {
      proxy: { url: 'http://proxy.example:8080' },
      aiImage: {
        proxy: { enable: true },
        c2pa: { enable: true },
        openai: { enable: false },
        hive: { enable: false },
        sightengine: { enable: false },
      },
    },
    {
      downloadImpl: async () => ({
        buffer: Buffer.from('image'),
        mimeType: 'image/png',
      }),
      readerFactory: async () => ({ getActive: () => null }),
      proxyAgentFactory: () => {
        proxyFactories += 1
        return { proxy: true }
      },
    },
  )

  assert.equal(proxyFactories, 0)
})

test('logs the AI image inspection lifecycle and provider durations', async () => {
  const logger = createMemoryLogger()
  let currentTime = 1000

  await inspectAiImage(
    'https://public.example/image.png?token=private-query',
    {
      aiImage: {
        c2pa: { enable: true },
        openai: { enable: false },
        hive: { enable: false },
        sightengine: { enable: false },
      },
    },
    {
      logger,
      now: () => (currentTime += 5),
      downloadImpl: async () => ({
        buffer: Buffer.alloc(2048),
        mimeType: 'image/png',
      }),
      readerFactory: async () => ({ getActive: () => null }),
    },
  )

  const messages = logger.entries.map(([, message]) => message)
  assert.match(messages[0], /\[AI图片识别\] 开始检测/)
  assert.ok(
    messages.some((message) =>
      /图片下载完成.*image\/png.*2048 字节.*耗时 \d+ ms/.test(message),
    ),
  )
  assert.ok(messages.some((message) => /C2PA 开始检测/.test(message)))
  assert.ok(
    messages.some((message) =>
      /C2PA 检测完成.*not_detected.*耗时 \d+ ms/.test(message),
    ),
  )
  assert.match(messages.at(-1), /检测汇总.*unknown.*low.*总耗时 \d+ ms/)
  assert.doesNotMatch(messages.join('\n'), /public\.example|private-query/)
})

test('logs normalized Hive evidence at debug level without sensitive data', async () => {
  const logger = createMemoryLogger()
  const imageUrl = 'https://public.example/image.png?token=private-query'
  const secret = 'hive-super-secret'

  const result = await inspectAiImage(
    imageUrl,
    {
      aiImage: {
        c2pa: { enable: false },
        openai: { enable: false },
        hive: { enable: true, apiKeys: [secret] },
        sightengine: { enable: false },
      },
    },
    {
      logger,
      downloadImpl: async () => ({
        buffer: Buffer.from('image'),
        mimeType: 'image/png',
      }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                classes: [
                  { class: 'ai_generated', value: 0.8774 },
                  { class: 'deepfake', value: 0.0001 },
                  { class: 'gptimage2', value: 0.7012 },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    },
  )

  const debugOutput = logger.entries
    .filter(([level]) => level === 'debug')
    .map(([, message]) => message)
    .join('\n')
  assert.match(debugOutput, /Hive 结果/)
  assert.match(debugOutput, /"aiGeneratedProbability":0\.8774/)
  assert.match(debugOutput, /"deepfakeProbability":0\.0001/)
  assert.match(debugOutput, /"generator":"gptimage2"/)
  assert.doesNotMatch(debugOutput, /raw|output|public\.example|private-query/)
  assert.doesNotMatch(debugOutput, new RegExp(secret))
  assert.doesNotMatch(result.message, /Deepfake 0\.0%/)
})

test('redacts image URLs and credentials from provider failure logs', async () => {
  const logger = createMemoryLogger()
  const imageUrl = 'https://public.example/image.png?token=sensitive-query'
  const openAiSecret = 'openai-super-secret'
  const hiveSecret = 'hive-super-secret'

  await inspectAiImage(
    imageUrl,
    {
      aiImage: {
        c2pa: { enable: false },
        openai: { enable: true, apiKeys: [openAiSecret] },
        hive: { enable: true, apiKeys: [hiveSecret] },
        sightengine: { enable: false },
      },
    },
    {
      logger,
      downloadImpl: async () => ({
        buffer: Buffer.from('image'),
        mimeType: 'image/png',
      }),
      fetchImpl: async (url) => {
        if (String(url).includes('openai.com')) {
          throw new Error(`request ${imageUrl} rejected ${openAiSecret}`)
        }
        return new Response(
          JSON.stringify({ message: `invalid ${hiveSecret}` }),
          { status: 403 },
        )
      },
    },
  )

  const output = logger.entries.map((entry) => entry.join(' ')).join('\n')
  assert.match(output, /OpenAI 检测失败/)
  assert.match(output, /Hive 不可用.*HTTP 403/)
  for (const sensitiveValue of [
    imageUrl,
    'public.example',
    'sensitive-query',
    openAiSecret,
    hiveSecret,
  ]) {
    assert.doesNotMatch(output, new RegExp(sensitiveValue))
  }
})

test('redacts image URLs from download errors exposed to callers', async () => {
  const imageUrl =
    'https://public.example/image.png?token=sensitive-download-query'

  await assert.rejects(
    inspectAiImage(
      imageUrl,
      {
        aiImage: {
          c2pa: { enable: true },
          openai: { enable: false },
          hive: { enable: false },
          sightengine: { enable: false },
        },
      },
      {
        downloadImpl: async () => {
          throw new Error(`download rejected ${imageUrl}`)
        },
      },
    ),
    (error) => {
      assert.match(error.message, /download rejected \[redacted-url\]/)
      assert.doesNotMatch(
        error.message,
        /public\.example|sensitive-download-query/,
      )
      return true
    },
  )
})
