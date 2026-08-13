function parseArray(value, fieldName) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []

  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${fieldName} 必须是合法的 JSON 数组`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} 必须是 JSON 数组`)
  return parsed
}

export function migrateAiImageConfig(config) {
  const value = structuredClone(config)
  const aiImage = value.aiImage
  if (!aiImage) return value

  if (aiImage.openai) {
    const apiKeys = parseApiKeys(aiImage.openai.apiKeys, 'OpenAI API keys')
    aiImage.openai.apiKeys = parseApiKeys([...apiKeys, aiImage.openai.apiKey])
    delete aiImage.openai.apiKey
    delete aiImage.openai.proxy
  }
  if (aiImage.hive) {
    aiImage.hive.apiKeys = parseApiKeys(
      aiImage.hive.apiKeys,
      'Hive V3 Secret Keys',
    )
    delete aiImage.hive.apiKey
    delete aiImage.hive.proxy
  }
  if (aiImage.sightengine) {
    const credentials = parseSightengineCredentials(
      aiImage.sightengine.credentials,
    )
    const legacyCredential = {
      apiUser: aiImage.sightengine.apiUser,
      apiSecret: aiImage.sightengine.apiSecret,
    }
    aiImage.sightengine.credentials = parseSightengineCredentials([
      ...credentials,
      legacyCredential,
    ])
    delete aiImage.sightengine.apiUser
    delete aiImage.sightengine.apiSecret
    delete aiImage.sightengine.proxy
  }
  return value
}

export function parseApiKeys(value, fieldName = 'API keys') {
  return parseArray(value, fieldName)
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseSightengineCredentials(value) {
  return parseArray(value, 'Sightengine 凭据')
    .map((item) => {
      if (typeof item !== 'string') return item
      try {
        return JSON.parse(item)
      } catch {
        throw new Error('Sightengine 每项凭据必须是合法的 JSON 对象')
      }
    })
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      apiUser: String(item.apiUser || '').trim(),
      apiSecret: String(item.apiSecret || '').trim(),
    }))
    .filter((item) => item.apiUser && item.apiSecret)
}

export function serializeAiImageCredentialFields(config) {
  const value = structuredClone(config)
  if (!value.aiImage) return value

  value.aiImage.openai.apiKeys = value.aiImage.openai.apiKeys || []
  value.aiImage.hive.apiKeys = value.aiImage.hive.apiKeys || []
  value.aiImage.sightengine.credentials = (
    value.aiImage.sightengine.credentials || []
  ).map((credential) => JSON.stringify(credential))
  return value
}
