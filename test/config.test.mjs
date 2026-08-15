import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('ships the MTPLX 2.7 Qwen 3.8 Optimized Speed Turbo D3 configuration', async () => {
  const runtime = await read('runtime/balto.mjs')
  for (const required of [
    "const engineVersion = '2.7.0'",
    "repo: 'Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed'",
    "repo: 'Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed-FP16'",
    "'--profile', 'turbo'",
    "'--generation-mode', 'mtp'",
    "'--depth', '3'",
    "'--batching-preset', 'agent'",
    "'--ssd-session-cache', 'on'",
    "'--reasoning-effort', 'medium'",
    "'--preserve-thinking', 'on'",
    "'--tool-prompt-mode', 'native'",
    "'--fan-mode', 'default'",
  ]) assert.ok(runtime.includes(required), required)
  assert.match(runtime, /memoryGib >= 96 \? 262144/)
  assert.match(runtime, /memoryGib >= 48 \? 65536 : 32768/)
  assert.match(runtime, /MTPLX_STATS_FOOTER_SCOPE: 'owned'/)
  assert.doesNotMatch(runtime, /--draft-temperature|--draft-top-p|--draft-top-k/)
  assert.doesNotMatch(runtime, /wired-limit|max-diagnostic|fan-mode', 'max'/)
})

test('one click installs private runtimes and preserves resumable model files', async () => {
  const runtime = await read('runtime/balto.mjs')
  const vision = await read('runtime/install-vision.mjs')
  const bootstrap = await read('scripts/prepare-runtime.sh')
  assert.match(bootstrap, /node-v\$node_version-darwin-arm64/)
  assert.match(bootstrap, /shasum -a 256/)
  assert.match(bootstrap, /uv-aarch64-apple-darwin/)
  assert.match(runtime, /`mtplx==\$\{engineVersion\}`/)
  assert.match(runtime, /installedVersion === engineVersion/)
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
  assert.match(runtime, /validModelAt\(paths\.legacy\)/)
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
  assert.match(native, /RunEvent::ExitRequested/)
  assert.match(native, /RunEvent::Exit/)
  assert.match(native, /stop_everything\(app_handle\)/)
})

test('Mac bundle is native, movable, updateable, and uses one embedded window', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'))
  const html = await read('src/index.html')
  const app = await read('src/app.js')
  const styles = await read('src/styles.css')
  const brand = await read('src/balto-mark.svg')
  const runtimeBrand = await read('runtime/assets/balto-mark.svg')
  const nativeShell = await read('src-tauri/src/lib.rs')
  assert.deepEqual(config.bundle.targets, ['dmg', 'app'])
  assert.ok(config.bundle.icon.includes('icons/icon.icns'))
  assert.equal(config.bundle.macOS.minimumSystemVersion, '14.0')
  assert.equal(config.bundle.macOS.dmg.background, 'dmg-background.tiff')
  assert.deepEqual(config.bundle.macOS.dmg.appPosition, { x: 330, y: 240 })
  assert.ok(config.bundle.macOS.dmg.applicationFolderPosition.x > config.bundle.macOS.dmg.windowSize.width)
  assert.equal(config.bundle.createUpdaterArtifacts, true)
  assert.match(config.plugins.updater.endpoints[0], /jtc268\/balto-speedrunner-mac/)
  assert.equal(config.app.windows[0].decorations, true)
  assert.equal(config.app.windows[0].resizable, true)
  assert.match(html, /data-tauri-drag-region/)
  assert.match(nativeShell, /http:\/\/127\.0\.0\.1:3080\//)
  assert.match(nativeShell, /fn install_from_disk_image\(\)/)
  assert.match(nativeShell, /Path::new\("\/Volumes"\)/)
  assert.match(nativeShell, /PathBuf::from\("\/Applications\/Balto Speedrunner\.app"\)/)
  assert.match(nativeShell, /Command::new\("\/usr\/bin\/ditto"\)/)
  assert.match(nativeShell, /Command::new\("\/usr\/bin\/codesign"\)/)
  assert.match(nativeShell, /\/usr\/bin\/open -n/)
  assert.match(nativeShell, /\/usr\/sbin\/diskutil eject/)
  assert.match(nativeShell, /fn navigate_to_workspace\(app: &AppHandle, fresh: bool\)/)
  assert.match(app, /async function openNativeWorkspace\(fresh = false\)/)
  assert.match(app, /await invoke\('open_workspace', \{ fresh \}\)/)
  assert.doesNotMatch(app, /workspaceFrame\.src|showEmbeddedWorkspace/)
  assert.equal(config.app.windows[0].titleBarStyle, 'Visible')
  assert.equal(config.app.windows[0].hiddenTitle, false)
  assert.match(html, /<body class="launch-pending">/)
  assert.match(html, /<iframe id="workspace-frame"/)
  assert.match(styles, /body\.launch-pending > \* \{ visibility: hidden; \}/)
  assert.match(styles, /grid-template-rows: 40px minmax\(0, 1fr\)/)
  assert.match(html, /class="runner-mark"/)
  assert.doesNotMatch(html, /dog-body|dog-tail|dog-leg|runner-dust/)
  assert.match(styles, /@keyframes balto-cruise/)
  assert.doesNotMatch(styles, /@keyframes balto-gallop|\.dog-body|\.dog-leg|\.runner-dust/)
  for (const mark of [brand, runtimeBrand]) {
    assert.match(mark, /#ff6b35/)
    assert.doesNotMatch(mark, /linearGradient|#ff4f8b|#9b5cff|#20c7ff|#27e7a1/)
  }
  assert.match(config.app.security.csp, /frame-src http:\/\/127\.0\.0\.1:3080/)
})

test('harness declares vision, terminal, web, and computer tools', async () => {
  const runtime = await read('runtime/balto.mjs')
  const settings = await read('runtime/templates/settings.yaml')
  const tools = await read('runtime/balto-tools-mcp.mjs')
  const patch = await read('runtime/patch-dsh.mjs')
  assert.match(settings, /defaultPreset: danger-full-access/)
  assert.match(settings, /- image/)
  assert.match(patch, /Explicit image attachments in user messages are visible/)
  assert.match(patch, /do not search the workspace or take a new screenshot/)
  assert.match(patch, /patchFirstTurnImageOrdering/)
  assert.match(patch, /for \(const message of orderedMessages\)/)
  for (const name of ['web_search', 'web_fetch', 'computer_screenshot', 'computer_click', 'computer_type', 'computer_hotkey', 'browser_open']) {
    assert.match(tools, new RegExp(`registerTool\\('${name}'`))
  }
  assert.match(tools, /Local and private network addresses are not available/)
  assert.match(tools, /Call read_image with this exact path/)
  assert.match(runtime, /- insert:\\n    - id: mcp-balto-tools/)
  assert.match(await read('src-tauri/src/lib.rs'), /Privacy_Accessibility/)
  assert.match(await read('src-tauri/src/lib.rs'), /Privacy_ScreenCapture/)
})

test('long jobs compact, retry transient streams, and continue automatically', async () => {
  const runtime = await read('runtime/balto.mjs')
  const settings = await read('runtime/templates/settings.yaml')
  const patch = await read('runtime/patch-dsh.mjs')
  const migration = await read('runtime/configure-settings.mjs')

  assert.match(runtime, /id: session-log-download\\n  disabled: true/)
  assert.match(runtime, /id: compaction-basic\\n  disabled: false/)
  assert.match(runtime, /thresholdRatio: 0\.45/)
  assert.match(runtime, /retainTokens: 12000/)
  assert.match(runtime, /maxOverflowRetries: 3/)
  assert.match(runtime, /id: tool-result-pruner\\n  disabled: false/)
  assert.match(runtime, /id: tool-goal\\n  disabled: false/)
  assert.match(settings, /retryPolicy:\s+mode: normal\s+maxRetries: 5/)
  assert.match(patch, /state\.needsCheckpoint = true/)
  assert.match(patch, /requestDrive\(state\)/)
  assert.match(migration, /providers\.balto/)
  assert.match(migration, /currentModels/)
})

test('release claims use the installed app benchmark', async () => {
  const readme = await read('README.md')
  const hero = await read('.github/assets/readme-hero.svg')
  const packageJson = JSON.parse(await read('package.json'))
  assert.match(readme, /Up to 2x Qwen 3\.8 27B/)
  assert.doesNotMatch(`${readme}\n${hero}`, /triple|3\.03×|84\.7/i)
  assert.match(hero, /1\.99×/)
  assert.match(hero, /55\.5/)
  assert.match(hero, /fill="#FF6B35"/)
  assert.equal(packageJson.scripts['audit:long-run'], 'node scripts/audit-long-run.mjs')
  assert.equal(packageJson.scripts['smoke:forced-compaction'], 'node scripts/smoke-forced-compaction.mjs')
})

test('readiness polling never generates model work', async () => {
  const runtime = await read('runtime/balto.mjs')
  assert.match(runtime, /enginePort}\/v1\/models/)
  assert.doesNotMatch(runtime, /enginePort}\/health/)
})

test('product UI is Mac-first and subscription-free', async () => {
  const html = await read('src/index.html')
  const app = await read('src/app.js')
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'))
  assert.match(html, /Built for Apple Silicon/)
  assert.match(html, /up to 2× faster/)
  assert.match(html, /No Homebrew, Docker, Terminal setup, account, or subscription required/)
  assert.match(html, /About 21 GB/)
  assert.match(html, /Powered by MTPLX: github\.com\/youssofal\/MTPLX/)
  assert.equal(config.bundle.resources['../THIRD_PARTY_NOTICES.md'], 'THIRD_PARTY_NOTICES.md')
  assert.match(app, /Apple M5 Max/)
  assert.doesNotMatch(`${html}\n${app}`, /RTX 5090|Windows 11|NVFP4|SGLang/)
})
