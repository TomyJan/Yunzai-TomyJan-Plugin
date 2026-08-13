import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeAiImageResults } from '../model/aiImageProviders.js'

test('prioritizes trusted provenance over probabilistic provider results', () => {
  const summary = summarizeAiImageResults([
    {
      provider: 'hive',
      status: 'detected',
      evidence: { aiGeneratedProbability: 0.99 },
    },
    {
      provider: 'c2pa',
      status: 'detected',
      evidence: {
        validationState: 'trusted',
        issuer: 'OpenAI OpCo, LLC',
        actions: ['c2pa.created'],
      },
    },
  ])

  assert.equal(summary.verdict, 'detected')
  assert.equal(summary.confidence, 'high')
  assert.match(summary.message, /^🔎 AI 图片识别结果/)
  assert.match(summary.message, /✅ 结论：检测到可信 C2PA 来源凭证/)
  assert.match(summary.message, /📊 可信度：高/)
  assert.match(summary.message, /\n\n检测渠道：\n/)
  assert.match(summary.message, /✅ C2PA：检测到支持的信号/)
  assert.match(summary.message, /✅ Hive：检测到支持的信号/)
  assert.match(summary.message, /ℹ️ 未检出不代表图片一定不是 AI 生成。$/)
  assert.match(summary.message, /C2PA/)
  assert.match(summary.message, /OpenAI OpCo, LLC/)
})

test('treats a valid C2PA manifest as high-confidence provenance', () => {
  const summary = summarizeAiImageResults([
    {
      provider: 'c2pa',
      status: 'detected',
      evidence: {
        validationState: 'valid',
        aiGenerated: true,
        issuer: 'Example issuer',
      },
    },
  ])

  assert.equal(summary.verdict, 'detected')
  assert.equal(summary.confidence, 'high')
  assert.match(summary.message, /C2PA/)
})

test('prioritizes a detected SynthID signal over probabilistic results', () => {
  const summary = summarizeAiImageResults([
    {
      provider: 'hive',
      status: 'detected',
      evidence: { aiGeneratedProbability: 0.72 },
    },
    {
      provider: 'openai',
      status: 'detected',
      signals: [{ type: 'synthid', outcome: 'detected', model: 'imagen' }],
    },
  ])

  assert.equal(summary.confidence, 'high')
  assert.match(summary.message, /✅ 结论：检测到 OpenAI SynthID 信号/)
  assert.match(summary.message, /SynthID/)
})

test('formats probabilistic detections with a medium-confidence warning', () => {
  const summary = summarizeAiImageResults([
    {
      provider: 'hive',
      status: 'detected',
      evidence: { aiGeneratedProbability: 0.97 },
    },
    { provider: 'c2pa', status: 'not_detected', evidence: {} },
  ])

  assert.equal(summary.verdict, 'detected')
  assert.equal(summary.confidence, 'medium')
  assert.match(summary.message, /⚠️ 结论：检测到 AI 生成或篡改信号（概率模型）/)
  assert.match(summary.message, /📊 可信度：中/)
  assert.match(summary.message, /✅ Hive：检测到支持的信号/)
  assert.match(summary.message, /ℹ️ C2PA：未发现支持的信号/)
})

test('treats an OpenAI valid C2PA signal as high-confidence provenance', () => {
  const summary = summarizeAiImageResults([
    {
      provider: 'openai',
      status: 'detected',
      signals: [
        { type: 'c2pa', outcome: 'detected', validationState: 'valid' },
      ],
    },
  ])

  assert.equal(summary.confidence, 'high')
  assert.match(summary.message, /C2PA/)
})

test('reports evidence insufficient when providers are available but detect nothing', () => {
  const summary = summarizeAiImageResults([
    { provider: 'c2pa', status: 'not_detected', evidence: {} },
    {
      provider: 'openai',
      status: 'not_detected',
      signals: [{ type: 'synthid', outcome: 'not_detected' }],
    },
    { provider: 'hive', status: 'not_detected', evidence: {} },
  ])

  assert.equal(summary.verdict, 'unknown')
  assert.match(summary.message, /❔ 结论：暂未发现明确的 AI 来源信号/)
  assert.match(summary.message, /📊 可信度：低/)
  assert.match(summary.message, /证据不足/)
  assert.match(summary.message, /ℹ️ C2PA：未发现支持的信号/)
  assert.match(summary.message, /ℹ️ OpenAI：未发现支持的信号/)
  assert.match(summary.message, /ℹ️ Hive：未发现支持的信号/)
})

test('explains missing provider credentials without changing the verdict', () => {
  const summary = summarizeAiImageResults([
    {
      provider: 'openai',
      status: 'unavailable',
      reason: 'missing_api_key',
    },
    {
      provider: 'hive',
      status: 'unavailable',
      reason: 'missing_api_key',
    },
    {
      provider: 'sightengine',
      status: 'unavailable',
      reason: 'missing_credentials',
    },
  ])

  assert.equal(summary.verdict, 'unknown')
  assert.match(summary.message, /不可用|失败/)
  assert.match(summary.message, /⏸️ OpenAI：未配置 API Key/)
  assert.match(summary.message, /⏸️ Hive：未配置 V3 Secret Key/)
  assert.match(summary.message, /⏸️ Sightengine：未配置 API 凭据/)
})

test('explains provider HTTP and timeout failures', () => {
  const summary = summarizeAiImageResults([
    {
      provider: 'openai',
      status: 'unavailable',
      error: 'HTTP 404',
      httpStatus: 404,
    },
    {
      provider: 'hive',
      status: 'unavailable',
      error: 'HTTP 429',
      httpStatus: 429,
    },
    {
      provider: 'sightengine',
      status: 'error',
      error: '检测渠道请求超时',
    },
    {
      provider: 'c2pa',
      status: 'error',
      reason: 'component_unavailable',
    },
  ])

  assert.match(summary.message, /OpenAI：无接口权限或接口未开放（HTTP 404）/)
  assert.match(summary.message, /Hive：请求频率受限（HTTP 429）/)
  assert.match(summary.message, /Sightengine：请求超时/)
  assert.match(summary.message, /C2PA：本地检测组件不可用/)
  assert.match(summary.message, /⏸️ OpenAI：/)
  assert.match(summary.message, /⏸️ Hive：/)
  assert.match(summary.message, /❌ Sightengine：/)
  assert.match(summary.message, /❌ C2PA：/)
})

test('explains unrecognized and unknown provider errors', () => {
  const summary = summarizeAiImageResults([
    { provider: 'hive', status: 'error', reason: 'invalid_response' },
    { provider: 'openai', status: 'error', error: 'upstream rejected image' },
  ])

  assert.match(summary.message, /Hive：响应格式无法识别/)
  assert.match(summary.message, /OpenAI：检测失败（upstream rejected image）/)
})
