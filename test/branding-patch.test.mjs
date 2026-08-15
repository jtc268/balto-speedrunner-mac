import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

test('branding patch runs before the upstream module and removes its boot wordmark', async () => {
  const root = await mkdtemp(join(tmpdir(), 'balto-branding-'))
  const dshRoot = join(root, 'dsh')
  const dist = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')
  const assets = join(dist, 'assets')
  const driver = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-goal-round-driver', 'lib')
  const webApp = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'lib')
  const llmAdapter = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib')
  const codePreset = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code')
  await mkdir(assets, { recursive: true })
  await mkdir(driver, { recursive: true })
  await mkdir(webApp, { recursive: true })
  await mkdir(llmAdapter, { recursive: true })
  await mkdir(codePreset, { recursive: true })
  await writeFile(
    join(dist, 'index.html'),
    '<html><head><title>DeepSeek Harness</title><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>',
  )
  await writeFile(join(assets, 'app.js'), 'const boot={children:"HARNESS"};const product="DeepSeek Harness"')
  await writeFile(join(driver, 'index.js'), `if (event.data.reason.kind === "max-tokens") {
\t\t\t\t\t\tdisarm(state);
\t\t\t\t\t\treturn;
\t\t\t\t\t}`)
  await writeFile(join(webApp, 'index.js'), 'The browser provides no implicit DOM, route, or screenshot context.')
  await writeFile(join(llmAdapter, 'index.js'), `async function toPiContextWithImages(options, attachments) {
\tconst toolNames = /* @__PURE__ */ new Map();
\tconst messages = [];
\tfor (const message of options.messages) {`)
  await writeFile(join(codePreset, 'agent.cordis.yml'), `- id: tool-presentation
  name: '@deepseek-ai/dsh-agent-tool-presentation'
  config:
    mode: code
`)

  try {
    await execFileAsync(process.execPath, [join(repoRoot, 'runtime', 'patch-dsh.mjs'), dshRoot, join(repoRoot, 'runtime')])
    const html = await readFile(join(dist, 'index.html'), 'utf8')
    const bundle = await readFile(join(assets, 'app.js'), 'utf8')
    const continuation = await readFile(join(driver, 'index.js'), 'utf8')
    const imageGuidance = await readFile(join(webApp, 'index.js'), 'utf8')
    const multimodalAdapter = await readFile(join(llmAdapter, 'index.js'), 'utf8')
    const patchedCodePreset = await readFile(join(codePreset, 'agent.cordis.yml'), 'utf8')
    assert.ok(html.indexOf('/assets/balto-ui.js') < html.indexOf('<script type="module"'))
    assert.match(html, /id="balto-prepaint"/)
    assert.match(html, /svg\[viewBox="0 0 182 24"\]\{visibility:hidden!important\}/)
    assert.doesNotMatch(html, /DeepSeek Harness/)
    assert.doesNotMatch(bundle, /HARNESS/)
    assert.doesNotMatch(bundle, /DeepSeek Harness/)
    assert.match(bundle, /children:"BALTO"/)
    assert.match(continuation, /state\.needsCheckpoint = true/)
    assert.match(continuation, /requestDrive\(state\)/)
    assert.match(imageGuidance, /Explicit image attachments in user messages are visible/)
    assert.doesNotMatch(imageGuidance, /no implicit DOM, route, or screenshot context/)
    assert.match(multimodalAdapter, /message\.source\?\.kind === "agent-instructions"/)
    assert.match(multimodalAdapter, /message\.source\?\.kind === "plugin"/)
    assert.match(multimodalAdapter, /for \(const message of orderedMessages\)/)
    assert.match(patchedCodePreset, /mode: both/)
    assert.doesNotMatch(patchedCodePreset, /mode: code/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preview badge is removed from the Balto hero', async () => {
  const script = await readFile(join(repoRoot, 'runtime', 'assets', 'balto-ui.js'), 'utf8')
  assert.match(script, /\[class\*="_previewBadge"\]/)
  assert.match(script, /display: none !important/)
  assert.match(script, /\['@deepseek-ai\/dsh-system-prompt', 'Balto system prompt'\]/)
})

test('live meter, attachment control, and mobile shell are present', async () => {
  const script = await readFile(join(repoRoot, 'runtime', 'assets', 'balto-ui.js'), 'utf8')
  assert.doesNotMatch(script, /class="balto-brand"/)
  assert.doesNotMatch(script, /class="balto-name">Balto/)
  assert.match(script, /class="balto-sprinter"/)
  assert.match(script, /@keyframes balto-sprint/)
  assert.match(script, /@keyframes balto-trail/)
  assert.match(script, /prefers-reduced-motion: reduce/)
  assert.match(script, /function positionSpeedBar\(\)/)
  assert.match(script, /\^Session log\\b/)
  assert.match(script, /getBoundingClientRect\(\)\.left \+ 12/)
  assert.match(script, /input\.accept = 'image\/png,image\/jpeg,image\/webp,image\/gif'/)
  assert.match(script, /option\.setAttribute\('aria-label', 'Attach file'\)/)
  assert.match(script, /new Event\('paste'/)
  assert.match(script, /const mobileSidebarQuery = window\.matchMedia\('\(max-width: 720px\)'\)/)
  assert.match(script, /#balto-mobile-sidebar-backdrop/)
  assert.match(script, /\.VOzbGW_panel \{ width: 100vw !important/)
  assert.match(script, /window\.visualViewport/)
  assert.match(script, /body\.balto-keyboard-open/)
  assert.match(script, /closeMobileSidebarAfterSelection/)
  assert.match(script, /#balto-remote-settings/)
  assert.match(script, /Copy link/)
})

test('signed updater stays available inside the coding workspace', async () => {
  const script = await readFile(join(repoRoot, 'runtime', 'assets', 'balto-ui.js'), 'utf8')
  assert.match(script, /const invoke = window\.__TAURI__\?\.core\?\.invoke/)
  assert.match(script, /id="balto-update-button"/)
  assert.match(script, /invoke\('check_for_updates'\)/)
  assert.match(script, /invoke\('install_update'\)/)
  assert.match(script, /setInterval\(checkForWorkspaceUpdate, 5 \* 60 \* 1000\)/)
  assert.match(script, /window\.addEventListener\('focus', checkForWorkspaceUpdate\)/)
  assert.match(script, /document\.visibilityState === 'visible'/)
})
