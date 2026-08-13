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
  assert.match(summary.message, /SynthID/)
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
  assert.match(summary.message, /证据不足/)
  assert.match(summary.message, /C2PA：未发现支持的信号/)
  assert.match(summary.message, /OpenAI：未发现支持的信号/)
  assert.match(summary.message, /Hive：未发现支持的信号/)
})

test('keeps provider failures from becoming an AI verdict', () => {
  const summary = summarizeAiImageResults([
    { provider: 'openai', status: 'error', error: 'timeout' },
    { provider: 'hive', status: 'unavailable' },
  ])

  assert.equal(summary.verdict, 'unknown')
  assert.match(summary.message, /不可用|失败/)
  assert.match(summary.message, /OpenAI：检测失败/)
  assert.match(summary.message, /Hive：未配置或不可用/)
})
