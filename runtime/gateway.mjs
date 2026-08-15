import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const host = '127.0.0.1'
const port = Number(process.env.BALTO_GATEWAY_PORT || 30100)
const upstream = new URL(process.env.BALTO_INFERENCE_URL || 'http://127.0.0.1:30000')
const servedModel = 'balto-qwen-3.8-27b'
const baltoData = process.env.BALTO_DATA || ''
const baltoResources = process.env.BALTO_RESOURCES || ''
const baltoNode = process.env.BALTO_NODE || process.execPath
const remoteStatePath = baltoData ? join(baltoData, 'state.json') : ''
let remoteAction = null

const speed = {
  state: 'idle',
  tokensPerSecond: 0,
  completionTokens: 0,
  elapsedSeconds: 0,
  updatedAt: new Date().toISOString(),
}

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  })
  response.end(body)
}

const LOCAL_REMOTE_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function configuredTailscaleDnsName() {
  if (!remoteStatePath) return null
  try {
    return JSON.parse(readFileSync(remoteStatePath, 'utf8')).tailscaleDnsName?.toLowerCase() || null
  } catch {
    return null
  }
}

function remoteOrigin(request) {
  const origin = request.headers.origin
  if (!origin) {
    const address = request.socket.remoteAddress || ''
    return /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(address) ? '*' : null
  }
  try {
    const url = new URL(origin)
    const hostname = url.hostname.toLowerCase()
    if (LOCAL_REMOTE_HOSTS.has(hostname)) return origin
    if (url.protocol === 'https:' && hostname === configuredTailscaleDnsName()) return origin
  } catch {}
  return null
}

function remoteJson(request, response, status, value) {
  const allowedOrigin = remoteOrigin(request)
  if (!allowedOrigin) {
    const body = JSON.stringify({ ok: false, error: 'Remote settings are available only inside Balto' })
    response.writeHead(403, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      vary: 'Origin',
    })
    response.end(body)
    return
  }
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  })
  response.end(body)
}

async function readRemoteStatus() {
  if (!remoteStatePath) return { available: false, remoteEnabled: false, remoteUrl: null }
  try {
    const state = JSON.parse(await readFile(remoteStatePath, 'utf8'))
    return {
      available: true,
      tailscaleInstalled: Boolean(state.tailscaleInstalled),
      tailscaleSignedIn: Boolean(state.tailscaleSignedIn),
      tailscaleDnsName: state.tailscaleDnsName || null,
      remoteEnabled: Boolean(state.remoteEnabled),
      remoteUrl: state.remoteUrl || null,
    }
  } catch (error) {
    return { available: false, remoteEnabled: false, remoteUrl: null, error: error.message }
  }
}

function runRemoteAction(enabled) {
  if (remoteAction) return remoteAction
  if (!baltoData || !baltoResources) return Promise.reject(new Error('Balto remote controls are not configured'))
  const args = [
    join(baltoResources, 'balto.mjs'),
    enabled ? 'remote-on' : 'remote-off',
    baltoData,
    baltoResources,
  ]
  remoteAction = new Promise((resolve, reject) => {
    const child = spawn(baltoNode, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let errorOutput = ''
    child.stderr.on('data', (chunk) => {
      if (errorOutput.length < 8192) errorOutput += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('exit', async (code) => {
      if (code === 0) {
        resolve()
        return
      }
      let stateMessage = ''
      try {
        const state = JSON.parse(await readFile(remoteStatePath, 'utf8'))
        stateMessage = state.warning || state.message || ''
      } catch {}
      reject(new Error(errorOutput.trim() || stateMessage || `Balto remote action exited with code ${code}`))
    })
  }).finally(() => {
    remoteAction = null
  })
  return remoteAction
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function tuneRequest(buffer, path) {
  if (!path.endsWith('/chat/completions')) return { buffer, auxiliary: false }
  const body = JSON.parse(buffer.toString('utf8'))
  const messageText = (body.messages || []).map((message) => {
    if (typeof message?.content === 'string') return message.content
    if (Array.isArray(message?.content)) return message.content.map((part) => part?.text || '').join('\n')
    return ''
  }).join('\n')
  const auxiliary = /Create a concise title for an AI coding-assistant session|Generate the session title from this JSON array/i.test(messageText)
  body.model = servedModel
  body.messages = body.messages?.map((message) =>
    message?.role === 'developer' ? { ...message, role: 'system' } : message,
  )
  // MTPLX 2.7 owns the Qwen 3.8 sampler preset for managed clients. This
  // preserves the model's official temperature 1.0 contract and lets each
  // optimized artifact supply its calibrated draft sampler.
  const requestedMaxTokens = Number(body.max_tokens ?? body.max_completion_tokens ?? 32768)
  body.max_tokens = Math.min(requestedMaxTokens, 32768)
  delete body.max_completion_tokens
  if (body.stream) {
    body.stream_options = { ...(body.stream_options || {}), include_usage: true, continuous_usage_stats: true }
  }
  return { buffer: Buffer.from(JSON.stringify(body)), auxiliary }
}

function updateSpeedFromEvent(line, requestState) {
  if (!line.startsWith('data:')) return
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return
  try {
    const event = JSON.parse(payload)
    const content = event?.choices?.[0]?.delta?.content
    const now = performance.now()
    if (content && !requestState.firstTokenAt) requestState.firstTokenAt = now
    const completionTokens = Number(
      event?.usage?.completion_tokens ||
      event?.mtplx_progress?.completion_tokens ||
      event?.mtplx_stats?.completion_tokens ||
      0,
    )
    if (completionTokens <= 0) return
    if (!requestState.firstTokenAt) requestState.firstTokenAt = now
    const elapsedSeconds = Math.max((now - requestState.firstTokenAt) / 1000, 0.001)
    if (completionTokens < 4 || elapsedSeconds < 0.02) return
    const measuredTokens = Math.max(completionTokens - 1, 1)
    speed.state = 'live'
    speed.completionTokens = completionTokens
    speed.elapsedSeconds = elapsedSeconds
    const engineSpeed = Number(
      event?.mtplx_stats?.decode_tok_s ||
      event?.mtplx_progress?.decode_tok_s ||
      event?.timings?.predicted_per_second ||
      event?.x_mtplx?.tokens_per_second ||
      event?.x_mtplx?.decode_tps ||
      0,
    )
    speed.tokensPerSecond = engineSpeed > 0 ? engineSpeed : measuredTokens / elapsedSeconds
    speed.updatedAt = new Date().toISOString()
  } catch {
    // Non-JSON SSE lines are passed through untouched.
  }
}

async function proxy(request, response) {
  const target = new URL(request.url, upstream)
  let body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request)
  let auxiliaryRequest = false
  try {
    if (body?.length) {
      const tuned = tuneRequest(body, target.pathname)
      body = tuned.buffer
      auxiliaryRequest = tuned.auxiliary
    }
  } catch (error) {
    json(response, 400, { error: { message: `Invalid JSON request: ${error.message}` } })
    return
  }

  const headers = { ...request.headers }
  for (const name of [
    'host',
    'connection',
    'proxy-connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'te',
    'trailer',
    'expect',
    'content-length',
  ]) delete headers[name]
  headers.authorization = headers.authorization || 'Bearer local-balto'
  if (!auxiliaryRequest && target.pathname.endsWith('/chat/completions')) headers['x-mtplx-client'] = 'mtplx_app'
  else delete headers['x-mtplx-client']
  if (body) headers['content-length'] = String(body.length)

  let upstreamResponse
  try {
    upstreamResponse = await fetch(target, { method: request.method, headers, body, duplex: body ? 'half' : undefined })
  } catch (error) {
    const detail = error.cause?.message || error.message
    json(response, 502, { error: { message: `Balto inference is unavailable: ${detail}` } })
    return
  }

  const responseHeaders = Object.fromEntries(upstreamResponse.headers.entries())
  responseHeaders['access-control-allow-origin'] = '*'
  responseHeaders['access-control-allow-headers'] = '*'
  delete responseHeaders['content-length']
  response.writeHead(upstreamResponse.status, responseHeaders)

  if (!upstreamResponse.body) {
    response.end()
    return
  }

  const isStream = (upstreamResponse.headers.get('content-type') || '').includes('text/event-stream')
  if (!isStream) {
    const output = Buffer.from(await upstreamResponse.arrayBuffer())
    response.end(output)
    return
  }

  if (!auxiliaryRequest) {
    speed.state = 'starting'
    speed.tokensPerSecond = 0
    speed.completionTokens = 0
    speed.elapsedSeconds = 0
    speed.updatedAt = new Date().toISOString()
  }
  const requestState = { firstTokenAt: 0, pending: '' }
  const reader = upstreamResponse.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      response.write(chunk)
      requestState.pending += chunk.toString('utf8')
      const lines = requestState.pending.split(/\r?\n/)
      requestState.pending = lines.pop() || ''
      if (!auxiliaryRequest) for (const line of lines) updateSpeedFromEvent(line, requestState)
    }
  } finally {
    if (!auxiliaryRequest) {
      speed.state = 'complete'
      speed.updatedAt = new Date().toISOString()
    }
    response.end()
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, 'http://127.0.0.1')
  if (requestUrl.pathname === '/remote' && request.method === 'OPTIONS') {
    const allowedOrigin = remoteOrigin(request)
    if (!allowedOrigin) {
      remoteJson(request, response, 403, { ok: false })
      return
    }
    response.writeHead(204, {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      vary: 'Origin',
    })
    response.end()
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    })
    response.end()
    return
  }
  if (requestUrl.pathname === '/remote' && request.method === 'GET') {
    remoteJson(request, response, 200, await readRemoteStatus())
    return
  }
  if (requestUrl.pathname === '/remote' && request.method === 'POST') {
    if (!remoteOrigin(request)) {
      remoteJson(request, response, 403, { ok: false })
      return
    }
    try {
      const body = JSON.parse((await readBody(request)).toString('utf8'))
      if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean')
      await runRemoteAction(body.enabled)
      remoteJson(request, response, 200, { ok: true, ...(await readRemoteStatus()) })
    } catch (error) {
      remoteJson(request, response, 500, { ok: false, error: error.message })
    }
    return
  }
  if (request.url === '/speed') {
    json(response, 200, speed)
    return
  }
  if (request.url === '/health') {
    try {
      const check = await fetch(new URL('/v1/models', upstream), { signal: AbortSignal.timeout(1500) })
      json(response, check.ok ? 200 : 503, { ok: check.ok, upstream: upstream.toString() })
    } catch (error) {
      json(response, 503, { ok: false, error: error.message })
    }
    return
  }
  await proxy(request, response)
})

server.listen(port, host, () => {
  console.log(`Balto gateway listening at http://${host}:${port}`)
})
