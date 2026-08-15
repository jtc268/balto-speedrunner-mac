import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const execFileAsync = promisify(execFile)
const workspace = process.env.BALTO_WORKSPACE || process.cwd()
const screenshots = join(workspace, '.balto', 'screenshots')
const server = new McpServer({ name: 'balto-tools', version: '1.0.0' })

function textResult(text) {
  return { content: [{ type: 'text', text }] }
}

function decodeEntities(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
  return value
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
}

function plainText(html) {
  return decodeEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function blockedAddress(address) {
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224
}

async function assertPublicUrl(input) {
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed.')
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not allowed.')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => blockedAddress(address))) throw new Error('Local and private network addresses are not available to the web tool.')
  return url
}

async function publicFetch(input, { timeoutMs = 30000, maxBytes = 2_000_000 } = {}) {
  let url = await assertPublicUrl(input)
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'BaltoSpeedrunner/1.0 (+local-user-agent)' },
    })
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = await assertPublicUrl(new URL(response.headers.get('location'), url).toString())
      continue
    }
    const length = Number(response.headers.get('content-length') || 0)
    if (length > maxBytes) throw new Error(`Response is larger than ${maxBytes} bytes.`)
    const reader = response.body?.getReader()
    const chunks = []
    let total = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Response exceeded ${maxBytes} bytes.`)
      }
      chunks.push(value)
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    return { response, url, body: bytes.toString('utf8') }
  }
  throw new Error('Too many redirects.')
}

server.registerTool('web_search', {
  title: 'Search the web',
  description: 'Search the public web without an account or subscription. Returns titles, URLs, and snippets.',
  inputSchema: {
    query: z.string().min(1).max(500).describe('Search query'),
    max_results: z.number().int().min(1).max(10).optional().describe('Maximum results, default 8'),
  },
}, async ({ query, max_results = 8 }) => {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const { body } = await publicFetch(endpoint, { timeoutMs: 30000, maxBytes: 1_500_000 })
  const rows = []
  const resultPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/)/gi
  for (const match of body.matchAll(resultPattern)) {
    let url = decodeEntities(match[1])
    if (url.startsWith('//')) url = `https:${url}`
    try {
      const parsed = new URL(url, 'https://duckduckgo.com')
      if (parsed.hostname.endsWith('duckduckgo.com') && parsed.searchParams.get('uddg')) url = decodeURIComponent(parsed.searchParams.get('uddg'))
    } catch {}
    rows.push({ title: plainText(match[2]), url, snippet: plainText(match[3] || '') })
    if (rows.length >= max_results) break
  }
  if (rows.length === 0) throw new Error('The public search endpoint returned no results. Try a shorter query.')
  const output = rows.map((row, index) => `${index + 1}. ${row.title}\n${row.url}\n${row.snippet}`).join('\n\n')
  return textResult(output)
})

server.registerTool('web_fetch', {
  title: 'Fetch a web page',
  description: 'Retrieve readable text from a public HTTP or HTTPS URL. Private-network addresses are blocked.',
  inputSchema: {
    url: z.string().url().describe('Public HTTP or HTTPS URL'),
    max_chars: z.number().int().min(1000).max(100000).optional().describe('Maximum returned characters, default 30000'),
  },
}, async ({ url, max_chars = 30000 }) => {
  const { response, url: finalUrl, body } = await publicFetch(url)
  const type = response.headers.get('content-type') || ''
  const content = type.includes('html') ? plainText(body) : body.trim()
  const clipped = content.length > max_chars ? `${content.slice(0, max_chars)}\n\n[Content truncated]` : content
  return textResult(`URL: ${finalUrl}\nHTTP: ${response.status}\n\n${clipped}`)
})

server.registerTool('computer_screenshot', {
  title: 'Take a Mac screenshot',
  description: 'Capture the current Mac display to a PNG inside the workspace. Then call read_image on the returned path to inspect it.',
  inputSchema: {},
}, async () => {
  await mkdir(screenshots, { recursive: true })
  const path = join(screenshots, `screen-${Date.now()}.png`)
  await execFileAsync('/usr/sbin/screencapture', ['-x', path])
  return textResult(`Screenshot saved to ${path}. Call read_image with this exact path before choosing coordinates.`)
})

server.registerTool('computer_click', {
  title: 'Click the Mac screen',
  description: 'Click an absolute screen coordinate. Requires Accessibility permission for Balto Speedrunner.',
  inputSchema: {
    x: z.number().int().min(0).max(20000),
    y: z.number().int().min(0).max(20000),
  },
}, async ({ x, y }) => {
  await execFileAsync('/usr/bin/osascript', ['-e', `tell application "System Events" to click at {${x}, ${y}}`])
  return textResult(`Clicked ${x}, ${y}.`)
})

server.registerTool('computer_type', {
  title: 'Type on the Mac',
  description: 'Type text into the focused control. Requires Accessibility permission for Balto Speedrunner.',
  inputSchema: { text: z.string().max(20000) },
}, async ({ text }) => {
  const script = 'on run argv\n tell application "System Events" to keystroke (item 1 of argv)\nend run'
  await execFileAsync('/usr/bin/osascript', ['-e', script, text])
  return textResult(`Typed ${text.length} characters.`)
})

server.registerTool('computer_hotkey', {
  title: 'Press a Mac keyboard shortcut',
  description: 'Press a safe keyboard shortcut such as command+c, command+v, command+l, command+tab, return, escape, or tab.',
  inputSchema: {
    keys: z.string().min(1).max(80).describe('Keys joined by +, for example command+l'),
  },
}, async ({ keys }) => {
  const parts = keys.toLowerCase().split('+').map((part) => part.trim()).filter(Boolean)
  const key = parts.pop()
  const modifiers = parts.map((part) => ({ command: 'command down', shift: 'shift down', option: 'option down', control: 'control down' }[part]))
  if (!key || modifiers.some((item) => !item)) throw new Error('Supported modifiers are command, shift, option, and control.')
  const keyCodes = { return: 36, enter: 36, tab: 48, escape: 53, esc: 53, space: 49, delete: 51, left: 123, right: 124, down: 125, up: 126 }
  const using = modifiers.length ? ` using {${modifiers.join(', ')}}` : ''
  const action = keyCodes[key] !== undefined ? `key code ${keyCodes[key]}` : /^[a-z0-9]$/.test(key) ? `keystroke "${key}"` : null
  if (!action) throw new Error('Use a single letter, digit, arrow, tab, return, escape, space, or delete key.')
  await execFileAsync('/usr/bin/osascript', ['-e', `tell application "System Events" to ${action}${using}`])
  return textResult(`Pressed ${keys}.`)
})

server.registerTool('browser_open', {
  title: 'Open a URL in the Mac browser',
  description: 'Open a public HTTP or HTTPS URL in the default Mac browser.',
  inputSchema: { url: z.string().url() },
}, async ({ url }) => {
  await assertPublicUrl(url)
  await execFileAsync('/usr/bin/open', [url])
  return textResult(`Opened ${url}. Use computer_screenshot to inspect the browser.`)
})

await server.connect(new StdioServerTransport())
