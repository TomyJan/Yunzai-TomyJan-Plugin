import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseDocument } from 'yaml'

const PROXY_PATH = ['client', 'postman', 'meta_data', 'proxies']

export function syncJmProxyConfig(optionPath, proxy = {}) {
  const original = fs.readFileSync(optionPath, 'utf8')
  const document = parseDocument(original)
  if (document.errors.length > 0) throw document.errors[0]

  const proxyUrl = String(proxy.url || '').trim()
  const desired = proxy.enable && proxyUrl ? proxyUrl : undefined
  const current = document.getIn(PROXY_PATH)
  if (current === desired) return false

  if (desired) document.setIn(PROXY_PATH, desired)
  else document.deleteIn(PROXY_PATH)

  const tempPath = path.join(
    path.dirname(optionPath),
    `.${path.basename(optionPath)}.${process.pid}.tmp`,
  )
  try {
    fs.writeFileSync(tempPath, document.toString(), 'utf8')
    fs.renameSync(tempPath, optionPath)
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  }
  return true
}
