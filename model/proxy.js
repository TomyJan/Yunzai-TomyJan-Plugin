import { ProxyAgent } from 'undici'

const dispatcherCache = new Map()
const warnedFeatures = new Set()

function getProxyUrl(pluginConfig) {
  return String(pluginConfig?.proxy?.url || '').trim()
}

export function getProxyDispatcher(pluginConfig, enabled, dependencies = {}) {
  if (!enabled) return undefined

  const proxyUrl = getProxyUrl(pluginConfig)
  if (!proxyUrl) {
    const feature = dependencies.feature || 'unknown'
    if (!warnedFeatures.has(feature)) {
      warnedFeatures.add(feature)
      dependencies.warn?.(`${feature} 已开启代理，但未配置代理服务器地址`)
    }
    return undefined
  }

  const factory =
    dependencies.proxyAgentFactory || ((url) => new ProxyAgent(url))
  if (dependencies.proxyAgentFactory) return factory(proxyUrl)
  if (!dispatcherCache.has(proxyUrl)) {
    dispatcherCache.set(proxyUrl, factory(proxyUrl))
  }
  return dispatcherCache.get(proxyUrl)
}

export function withProxy(init, pluginConfig, enabled, dependencies = {}) {
  const dispatcher = getProxyDispatcher(pluginConfig, enabled, dependencies)
  return dispatcher ? { ...init, dispatcher } : init
}
