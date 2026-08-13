import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import {
  checkC2pa,
  checkHive,
  checkOpenAi,
  checkSightengine,
} from '../model/aiImageProviders.js'

test('rotates OpenAI keys after unavailable credential responses', async () => {
  const keys = []
  const fetchImpl = async (_url, init) => {
    keys.push(init.headers.Authorization)
    const failures = [401, 403, 404, 429]
    if (keys.length <= failures.length) {
      return new Response(JSON.stringify({ error: 'unavailable key' }), {
        status: failures[keys.length - 1],
      })
    }
    return new Response(
      JSON.stringify({
        results: [{ type: 'synthid', outcome: 'not_detected' }],
      }),
      {
        status: 200,
      },
    )
  }

  const result = await checkOpenAi(Buffer.from('image'), {
    apiKeys: [
      'first-key',
      'second-key',
      'third-key',
      'fourth-key',
      'fifth-key',
    ],
    fetchImpl,
  })

  assert.equal(result.status, 'not_detected')
  assert.deepEqual(keys, [
    'Bearer first-key',
    'Bearer second-key',
    'Bearer third-key',
    'Bearer fourth-key',
    'Bearer fifth-key',
  ])
})

test('advances the OpenAI rotation starting key on each call', async () => {
  const authorizations = []
  const fetchImpl = async (_url, init) => {
    authorizations.push(init.headers.Authorization)
    return new Response(
      JSON.stringify({
        results: [{ type: 'synthid', outcome: 'not_detected' }],
      }),
      {
        status: 200,
      },
    )
  }
  await checkOpenAi(Buffer.from('image'), {
    apiKeys: ['rotation-a', 'rotation-b'],
    fetchImpl,
  })
  await checkOpenAi(Buffer.from('image'), {
    apiKeys: ['rotation-a', 'rotation-b'],
    fetchImpl,
  })

  assert.deepEqual(authorizations, ['Bearer rotation-a', 'Bearer rotation-b'])
})

test('ignores removed singular API key settings', async () => {
  let requested = false
  const result = await checkOpenAi(Buffer.from('image'), {
    apiKey: 'legacy-key',
    fetchImpl: async () => {
      requested = true
      return new Response('{}')
    },
  })

  assert.equal(result.status, 'unavailable')
  assert.equal(requested, false)
})

test('uses the shared proxy settings without provider-local proxy fields', async () => {
  const dispatchers = []
  const proxyAgentFactory = (url) => ({ proxyUrl: url })
  const fetchImpl = async (_url, init) => {
    dispatchers.push(init.dispatcher)
    return new Response(
      JSON.stringify({
        results: [{ type: 'synthid', outcome: 'not_detected' }],
      }),
      { status: 200 },
    )
  }

  await checkOpenAi(Buffer.from('image'), {
    apiKeys: ['proxy-key'],
    fetchImpl,
    pluginConfig: { proxy: { url: 'http://proxy.example:8080' } },
    proxyEnabled: true,
    proxyAgentFactory,
  })
  await checkOpenAi(Buffer.from('image'), {
    apiKeys: ['direct-key'],
    fetchImpl,
    pluginConfig: { proxy: { url: 'http://proxy.example:8080' } },
    proxyEnabled: false,
    proxyAgentFactory,
  })

  assert.deepEqual(dispatchers, [
    { proxyUrl: 'http://proxy.example:8080' },
    undefined,
  ])
})

test('normalizes a trusted active C2PA manifest and AI action', async () => {
  const reader = {
    getActive() {
      return {
        label: 'urn:uuid:manifest-1',
        validation_state: 'trusted',
        issuer: 'OpenAI OpCo, LLC',
        assertions: [
          {
            label: 'c2pa.actions',
            data: {
              actions: [
                {
                  action: 'c2pa.created',
                  digital_source_type:
                    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
                },
              ],
            },
          },
        ],
      }
    },
  }

  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => reader,
  })

  assert.equal(result.provider, 'c2pa')
  assert.equal(result.status, 'detected')
  assert.equal(result.evidence.validationState, 'trusted')
  assert.equal(result.evidence.issuer, 'OpenAI OpCo, LLC')
  assert.deepEqual(result.evidence.actions, ['c2pa.created'])
})

test('keeps a C2PA claim generator separate from the issuer', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => ({
      getActive: () => ({
        validation_state: 'trusted',
        claim_generator_info: [{ name: 'Example editor' }],
        digital_source_type:
          'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
      }),
    }),
  })

  assert.equal(result.evidence.issuer, undefined)
  assert.equal(result.evidence.claimGenerator, 'Example editor')
})

test('returns not_detected when C2PA has no active manifest', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => ({ getActive: () => null }),
  })

  assert.equal(result.status, 'not_detected')
})

test('does not report malformed C2PA assets as a missing local component', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => {
      throw new Error('failed to load malformed asset')
    },
  })

  assert.equal(result.status, 'error')
  assert.equal(result.reason, undefined)
})

test('reports an unavailable C2PA module as a missing local component', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => {
      throw new Error("Cannot find package '@contentauth/c2pa-node'")
    },
  })

  assert.equal(result.status, 'error')
  assert.equal(result.reason, 'component_unavailable')
})

test('keeps the default C2PA reader local-only', async () => {
  let readerOptions
  await checkC2pa(Buffer.from('image'), {
    readerFactory: async (_buffer, options) => {
      readerOptions = options
      return { getActive: () => null }
    },
  })

  assert.equal(readerOptions.readerSettings.verify.ocsp_fetch, false)
  assert.equal(readerOptions.readerSettings.verify.remote_manifest_fetch, false)
})

test('does not treat a trusted camera manifest as AI evidence', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => ({
      getActive: () => ({
        validation_state: 'trusted',
        issuer: 'Camera Manufacturer',
        assertions: [
          { label: 'c2pa.actions', data: { actions: ['c2pa.created'] } },
        ],
      }),
    }),
  })

  assert.equal(result.status, 'not_detected')
  assert.equal(result.evidence.aiGenerated, false)
})

test('uses a valid empty C2PA validation status as trusted', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => ({
      json: () => ({ validation_status: [] }),
      getActive: () => ({
        digital_source_type:
          'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
      }),
    }),
  })

  assert.equal(result.status, 'detected')
  assert.equal(result.evidence.validationState, 'trusted')
})

test('does not trust AI assertions from an invalid C2PA manifest', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => ({
      getActive: () => ({
        validation_state: 'invalid',
        digital_source_type:
          'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
      }),
    }),
  })

  assert.equal(result.status, 'not_detected')
  assert.equal(result.evidence.aiGenerated, true)
  assert.equal(result.evidence.validationState, 'invalid')
})

test('reads AI source types from mapped C2PA assertions', async () => {
  const result = await checkC2pa(Buffer.from('image'), {
    readerFactory: async () => ({
      getActive: () => ({
        validation_state: 'valid',
        assertions: {
          actions: {
            data: {
              actions: [
                {
                  action: 'c2pa.created',
                  digital_source_type:
                    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
                },
              ],
            },
          },
        },
      }),
    }),
  })

  assert.equal(result.status, 'detected')
  assert.equal(result.evidence.validationState, 'valid')
})

test('uploads OpenAI content provenance multipart and normalizes signals', async () => {
  let request
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return new Response(
      JSON.stringify({
        results: [
          {
            type: 'c2pa',
            outcome: 'detected',
            validation_state: 'trusted',
            issuer: 'OpenAI OpCo, LLC',
            model: 'gpt-image',
          },
          { type: 'synthid', outcome: 'not_detected' },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  const result = await checkOpenAi(Buffer.from('image'), {
    apiKeys: ['secret-key'],
    fetchImpl,
    mimeType: 'image/png',
  })

  assert.equal(
    request.url,
    'https://api.openai.com/v1/content_provenance_checks',
  )
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers.Authorization, 'Bearer secret-key')
  assert.equal(request.init.body instanceof FormData, true)
  assert.equal(result.status, 'detected')
  assert.deepEqual(
    result.signals.map(({ type, outcome }) => ({ type, outcome })),
    [
      { type: 'c2pa', outcome: 'detected' },
      { type: 'synthid', outcome: 'not_detected' },
    ],
  )
})

test('reports unavailable when OpenAI key is missing', async () => {
  const result = await checkOpenAi(Buffer.from('image'), { apiKeys: [] })
  assert.equal(result.status, 'unavailable')
})

test('does not expose credentials in provider errors', async () => {
  const secret = 'super-secret-openai-key'
  const result = await checkOpenAi(Buffer.from('image'), {
    apiKeys: [secret],
    fetchImpl: async () => {
      throw new Error(`request rejected for ${secret}`)
    },
  })

  assert.equal(result.status, 'error')
  assert.doesNotMatch(result.error, new RegExp(secret))
})

test('calls Hive V3 with a media URL and Secret Key', async () => {
  let request
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return new Response(
      JSON.stringify({
        output: [
          {
            classes: [
              { class: 'not_ai_generated', value: 0.02 },
              { class: 'ai_generated', value: 0.98 },
              { class: 'flux', value: 0.87 },
              { class: 'midjourney', value: 0.11 },
              { class: 'deepfake', value: 0.31 },
            ],
          },
        ],
      }),
    )
  }

  const result = await checkHive(Buffer.from('image'), {
    apiKeys: ['hive-v3-secret-key'],
    imageUrl: 'https://public.example/image.png',
    fetchImpl,
  })

  assert.equal(
    request.url,
    'https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection',
  )
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers.Authorization, 'Bearer hive-v3-secret-key')
  assert.equal(request.init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.init.body), {
    input: [{ media_url: 'https://public.example/image.png' }],
    processing_mode: 'sync_with_fallback',
  })
  assert.equal(result.provider, 'hive')
  assert.equal(result.status, 'detected')
  assert.equal(result.evidence.aiGeneratedProbability, 0.98)
  assert.equal(result.evidence.generator, 'flux')
  assert.equal(result.evidence.generatorProbability, 0.87)
  assert.equal(result.evidence.deepfake, false)
  assert.equal(result.evidence.deepfakeProbability, 0.31)
})

test('uses the Hive recommended 0.9 detection threshold', async () => {
  const result = await checkHive(Buffer.from('image'), {
    apiKeys: ['hive-v3-secret-key'],
    imageUrl: 'https://public.example/image.png',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              classes: [
                { class: 'not_ai_generated', value: 0.11 },
                { class: 'ai_generated', value: 0.89 },
                { class: 'deepfake', value: 0.89 },
              ],
            },
          ],
        }),
      ),
  })

  assert.equal(result.status, 'not_detected')
  assert.equal(result.evidence.aiGeneratedProbability, 0.89)
  assert.equal(result.evidence.deepfake, false)
})

test('detects a Hive V3 deepfake score at the recommended threshold', async () => {
  const result = await checkHive(Buffer.from('image'), {
    apiKeys: ['hive-v3-secret-key'],
    imageUrl: 'https://public.example/image.png',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              classes: [
                { class: 'not_ai_generated', value: 0.99 },
                { class: 'ai_generated', value: 0.01 },
                { class: 'deepfake', value: 0.9 },
              ],
            },
          ],
        }),
      ),
  })

  assert.equal(result.status, 'detected')
  assert.equal(result.evidence.deepfake, true)
})

test('rotates Hive V3 Secret Keys after authentication failures', async () => {
  const authorizations = []
  const result = await checkHive(Buffer.from('image'), {
    apiKeys: ['first-secret', 'second-secret'],
    imageUrl: 'https://public.example/image.png',
    fetchImpl: async (_url, init) => {
      authorizations.push(init.headers.Authorization)
      if (authorizations.length === 1)
        return new Response('{}', { status: 401 })
      return new Response(
        JSON.stringify({
          output: [
            {
              classes: [
                { class: 'not_ai_generated', value: 0.99 },
                { class: 'ai_generated', value: 0.01 },
              ],
            },
          ],
        }),
      )
    },
  })

  assert.equal(result.status, 'not_detected')
  assert.deepEqual(authorizations, [
    'Bearer first-secret',
    'Bearer second-secret',
  ])
})

test('does not accept Hive V2 response shapes', async () => {
  const result = await checkHive(Buffer.from('image'), {
    apiKeys: ['hive-v3-secret-key'],
    imageUrl: 'https://public.example/image.png',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          status: [
            {
              response: {
                output: [{ classes: [{ class: 'ai_generated', score: 0.99 }] }],
              },
            },
          ],
        }),
      ),
  })

  assert.equal(result.status, 'error')
  assert.equal(result.reason, 'invalid_response')
})

test('reports an error when Hive returns no recognizable detection result', async () => {
  const result = await checkHive(Buffer.from('image'), {
    apiKeys: ['hive-v3-secret-key'],
    imageUrl: 'https://public.example/image.png',
    fetchImpl: async () => new Response(JSON.stringify({ status: 'success' })),
  })

  assert.equal(result.status, 'error')
})

test('normalizes Sightengine genai result', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ type: { ai_generated: 0.91 } }), {
      status: 200,
    })

  const result = await checkSightengine(Buffer.from('image'), {
    credentials: [{ apiUser: 'user', apiSecret: 'secret' }],
    fetchImpl,
  })

  assert.equal(result.provider, 'sightengine')
  assert.equal(result.status, 'detected')
  assert.equal(result.evidence.aiGeneratedProbability, 0.91)
})

test('reports an error when Sightengine returns no genai probability', async () => {
  const result = await checkSightengine(Buffer.from('image'), {
    credentials: [{ apiUser: 'user', apiSecret: 'secret' }],
    fetchImpl: async () => new Response(JSON.stringify({ status: 'success' })),
  })

  assert.equal(result.status, 'error')
})

test('rotates Sightengine credential pairs after rate limiting', async () => {
  const users = []
  const fetchImpl = async (_url, init) => {
    const fields = [...init.body.entries()]
    const fieldMap = Object.fromEntries(
      fields.filter(([name]) => name !== 'media'),
    )
    users.push(fieldMap.api_user)
    if (users.length === 1) return new Response('{}', { status: 429 })
    return new Response(JSON.stringify({ type: { ai_generated: 0.1 } }), {
      status: 200,
    })
  }
  const result = await checkSightengine(Buffer.from('image'), {
    credentials: [
      { apiUser: 'first-user', apiSecret: 'first-secret' },
      { apiUser: 'second-user', apiSecret: 'second-secret' },
    ],
    fetchImpl,
  })
  assert.equal(result.status, 'not_detected')
  assert.deepEqual(users, ['first-user', 'second-user'])
})
