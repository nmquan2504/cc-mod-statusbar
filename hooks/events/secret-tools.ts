import { logAudit } from '../features/audit'
import { acquire, cache, kcLoad, listSecrets, meta, normName, scrub } from '../features/vault'
import type { Binding } from '../features/vault'
import { rt } from '../state/runtime'

import type { On } from 'claude-code'

export function registerSecretTools(on: On) {
  on('tool.call', { tool: 'mcp__cc-mod-statusbar__secret_list' }, async $ => ({ result: await listSecrets($) }))
    .catch(() => ({ deny: 'statusbar vault: could not list secrets.' }))

  on('tool.call', { tool: 'mcp__cc-mod-statusbar__secret_request' }, async ($, e: any) => {
    const r = await acquire($, { name: e.name, purpose: String(e.purpose ?? '') })
    if ('error' in r) return { deny: `statusbar vault: ${r.error}. Do not ask for the secret in chat.` }
    return { result: `${r.name} saved; it can be sent only to ${r.binding.host}. Use secret_fetch with name "${r.name}".` }
  }).catch(() => ({ deny: 'statusbar vault: the dialog failed. Ask the person to run /secret.' }))

  on('tool.call', { tool: 'mcp__cc-mod-statusbar__secret_fetch' }, async ($, e: any) => {
    const name = normName(String(e.name ?? ''))
    let url: URL
    try {
      url = new URL(String(e.url ?? ''))
    } catch {
      return { deny: 'secret_fetch needs an absolute https URL.' }
    }
    if (url.protocol !== 'https:') return { deny: 'secret_fetch sends secrets over https only.' }

    let binding = (await $.store.get(meta(name))) as Binding | undefined
    let value = binding ? await kcLoad($, name) : undefined
    if (!binding || !value) {
      const r = await acquire($, { name, purpose: `to call ${url.host}` })
      if ('error' in r) return { deny: `statusbar vault: ${name} is not saved (${r.error}). Ask the person to run /secret ${name}.` }
      binding = r.binding
      value = cache.get(name)
    }
    const host = url.hostname.toLowerCase()
    if (host !== binding.host && !host.endsWith(`.${binding.host}`)) {
      await logAudit($, `blocked ${name} to ${host} (bound to ${binding.host})`, true)
      return { deny: `statusbar vault: ${name} may be sent only to ${binding.host}, not ${host}.` }
    }

    const method = String(e.method ?? 'GET').toUpperCase()
    if (rt.isTainted && method !== 'GET') {
      await logAudit($, `blocked ${method} ${host} with ${name} after web content`, true)
      return { deny: `statusbar vault: the session has read web content; ${name} may only be used for GET now.` }
    }
    await logAudit($, `vault: ${method} ${host} with ${name}`)
    let res
    try {
      res = await $.http.fetch(url.toString(), {
        method,
        headers: { [binding.header]: `${binding.scheme}${value}` },
        body: e.body,
      })
    } catch {
      return { deny: `statusbar vault: could not reach ${host} (network or proxy).` }
    }
    return { result: scrub(`HTTP ${res.status}\n${res.text}`).slice(0, 50_000) }
  }).catch(() => ({ deny: 'statusbar vault: the request failed.' }))
}
