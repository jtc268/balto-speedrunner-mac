import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('ships the proven Qwen 3.8 27B Turbo D3 configuration', async () => {
  const runtime = await read('runtime/balto.mjs')
  for (const required of [
    "const modelRepo = 'hashtofu/Qwen3.8-27B-MTPLX-4bit'",
    "'--profile', 'turbo'",
    "'--generation-mode', 'mtp'",
    "'--depth', '3'",
    "'--draft-temperature', '0.70'",
    "'--draft-top-p', '0.95'",
    "'--draft-top-k', '20'",
    "'--batching-preset', 'agent'",
    "'--ssd-session-cache', 'on'",
    "'--preserve-thinking', 'scoped'",
    "'--tool-prompt-mode', 'native'",
    "'--fan-mode', 'default'",
  ]) assert.ok(runtime.includes(required), required)
  assert.match(runtime, /memoryGib >= 96 \? 262144/)
  assert.match(runtime, /memoryGib >= 48 \? 65536 : 32768/)
  assert.match(runtime, /MTPLX_STATS_FOOTER_SCOPE: 'owned'/)
  assert.doesNotMatch(runtime, /wired-limit|max-diagnostic|fan-mode', 'max'/)
})

test('one click installs private runtimes and preserves resumable model files', async () => {
  const runtime = await read('runtime/balto.mjs')
  const vision = await read('runtime/install-vision.mjs')
  const bootstrap = await read('scripts/prepare-runtime.sh')
  assert.match(bootstrap, /node-v\$node_version-darwin-arm64/)
  assert.match(bootstrap, /shasum -a 256/)
  assert.match(bootstrap, /uv-aarch64-apple-darwin/)
  assert.match(runtime, /'mtplx==2\.6\.0'/)
  assert.match(runtime, /'@deepseek-ai\/dsh@0\.1\.0-rc\.6'/)
  assert.match(runtime, /npm_config_target_arch: 'arm64'/)
  assert.match(runtime, /const webProfileRoot = join\(dshHome, 'profiles', 'web'\)/)
  assert.match(runtime, /'@deepseek-ai\/dsh-web-app'/)
  assert.match(runtime, /COPYFILE_FICLONE/)
  assert.match(runtime, /install-vision\.mjs/)
  assert.match(vision, /mlx-community\/Qwen3\.8-27B-4bit/)
  assert.match(vision, /name\.startsWith\('vision_tower\.'\)/)
  assert.match(runtime, /'--progress-json'/)
  assert.match(runtime, /Downloads resume automatically/)
  assert.match(runtime, /validModelAt\(legacyModelPath\)/)
  assert.match(runtime, /const workspaceRoot = join\(homedir\(\), 'Balto'\)/)
  assert.doesNotMatch(runtime, /join\(homedir\(\), 'Documents', 'Balto'\)/)
  assert.match(runtime, /mkdir\(workspaceRoot/)
})

test('closing the app synchronously stops every owned process group', async () => {
  const runtime = await read('runtime/balto.mjs')
  const native = await read('src-tauri/src/lib.rs')
  assert.match(runtime, /await stopProcess\('workspace'\)/)
  assert.match(runtime, /await stopProcess\('gateway'\)/)
  assert.match(runtime, /await stopProcess\('engine'\)/)
  assert.match(runtime, /process\.kill\(-pid, 'SIGTERM'\)/)
  assert.match(runtime, /process\.kill\(-pid, 'SIGKILL'\)/)
  assert.match(runtime, /childEnvironment\.PWD = cwd/)
  assert.match(native, /WindowEvent::CloseRequested/)
  assert.match(native, /api\.prevent_close\(\)/)
  assert.match(native, /stop_everything\(window\.app_handle\(\)\)/)
  assert.match(native, /window\.app_handle\(\)\.exit\(0\)/)
})

test('Mac bundle is native, movable, updateable, and uses one embedded window', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'))
  const html = await read('src/index.html')
  assert.deepEqual(config.bundle.targets, ['dmg', 'app'])
  assert.equal(config.bundle.macOS.minimumSystemVersion, '14.0')
  assert.equal(config.bundle.createUpdaterArtifacts, true)
  assert.match(config.plugins.updater.endpoints[0], /jtc268\/balto-speedrunner-mac/)
  assert.equal(config.app.windows[0].decorations, true)
  assert.equal(config.app.windows[0].resizable, true)
  assert.match(html, /data-tauri-drag-region/)
  assert.match(await read('src-tauri/src/lib.rs'), /http:\/\/127\.0\.0\.1:3080\//)
})

test('harness declares vision, terminal, web, and computer tools', async () => {
  const runtime = await read('runtime/balto.mjs')
  const settings = await read('runtime/templates/settings.yaml')
  const tools = await read('runtime/balto-tools-mcp.mjs')
  assert.match(settings, /defaultPreset: danger-full-access/)
  assert.match(settings, /- image/)
  for (const name of ['web_search', 'web_fetch', 'computer_screenshot', 'computer_click', 'computer_type', 'computer_hotkey', 'browser_open']) {
    assert.match(tools, new RegExp(`registerTool\\('${name}'`))
  }
  assert.match(tools, /Local and private network addresses are not available/)
  assert.match(tools, /Call read_image with this exact path/)
  assert.match(runtime, /- insert:\\n    - id: mcp-balto-tools/)
  assert.match(await read('src-tauri/src/lib.rs'), /Privacy_Accessibility/)
  assert.match(await read('src-tauri/src/lib.rs'), /Privacy_ScreenCapture/)
})

test('product UI is Mac-first and subscription-free', async () => {
  const html = await read('src/index.html')
  const app = await read('src/app.js')
  assert.match(html, /Built for Apple Silicon/)
  assert.match(html, /up to 3× faster/)
  assert.match(html, /No Homebrew, Docker, Terminal setup, account, or subscription required/)
  assert.match(html, /About 17 GB/)
  assert.match(app, /Apple M5 Max/)
  assert.doesNotMatch(`${html}\n${app}`, /RTX 5090|Windows 11|NVFP4|SGLang/)
})
