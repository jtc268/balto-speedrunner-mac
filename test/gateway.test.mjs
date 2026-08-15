import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

test('gateway preserves MTPLX-owned sampling and reports exact streaming speed', async (context) => {
  const gatewaySource = await readFile(new URL('../runtime/gateway.mjs', import.meta.url), 'utf8')
  assert.match(gatewaySource, /'connection'/)
  assert.match(gatewaySource, /'transfer-encoding'/)
  assert.match(gatewaySource, /error\.cause\?\.message/)
  assert.match(gatewaySource, /completionTokens < 4/)
  assert.match(gatewaySource, /x-mtplx-client.*mtplx_app/)
  assert.match(gatewaySource, /Create a concise title for an AI coding-assistant session/)
  assert.match(gatewaySource, /new URL\('\/v1\/models', upstream\)/)
  assert.doesNotMatch(gatewaySource, /new URL\('\/health', upstream\)/)
  let received
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"object":"list","data":[]}')
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (let token = 1; token <= 4; token++) {
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: { content: 'x' } }],
        usage: { completion_tokens: token },
        ...(token === 4 ? { mtplx_stats: { completion_tokens: 4, decode_tok_s: 72.5 } } : {}),
      })}\n\n`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    response.end('data: [DONE]\n\n')
  })
  const upstreamPort = await listen(upstream)
  context.after(() => upstream.close())

  const portProbe = http.createServer()
  const gatewayPort = await listen(portProbe)
  await new Promise((resolve) => portProbe.close(resolve))

  const child = spawn(process.execPath, [fileURLToPath(new URL('../runtime/gateway.mjs', import.meta.url))], {
    env: {
      ...process.env,
      BALTO_GATEWAY_PORT: String(gatewayPort),
      BALTO_INFERENCE_URL: `http://127.0.0.1:${upstreamPort}`,
    },
    stdio: 'ignore',
  })
  context.after(() => child.kill())

  await waitFor(`http://127.0.0.1:${gatewayPort}/health`)
  const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'anything',
      stream: true,
      max_completion_tokens: 4096,
      messages: [
        { role: 'developer', content: 'You are Balto.' },
        { role: 'user', content: 'test' },
      ],
    }),
  })
  assert.equal(response.status, 200)
  await response.text()

  assert.equal(received.model, 'balto-qwen-3.8-27b')
  assert.equal(received.messages[0].role, 'system')
  assert.equal(received.max_tokens, 4096)
  assert.equal('max_completion_tokens' in received, false)
  assert.equal('temperature' in received, false)
  assert.equal('top_p' in received, false)
  assert.equal('top_k' in received, false)
  assert.equal('seed' in received, false)
  assert.equal(received.stream_options.continuous_usage_stats, true)

  const telemetry = await fetch(`http://127.0.0.1:${gatewayPort}/speed`).then((item) => item.json())
  assert.equal(telemetry.state, 'complete')
  assert.equal(telemetry.completionTokens, 4)
  assert.equal(telemetry.tokensPerSecond, 72.5)

  const titleResponse = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'anything',
      stream: true,
      messages: [{ role: 'system', content: 'Create a concise title for an AI coding-assistant session.' }],
    }),
  })
  await titleResponse.text()
  const afterTitle = await fetch(`http://127.0.0.1:${gatewayPort}/speed`).then((item) => item.json())
  assert.deepEqual(afterTitle, telemetry)
})
