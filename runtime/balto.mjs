import { execFile, execFileSync, spawn } from 'node:child_process'
import { appendFileSync, closeSync, constants, existsSync, openSync, readFileSync, statfsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const [action, dataRootArg, resourcesArg] = process.argv.slice(2)
if (!action || !dataRootArg || !resourcesArg) throw new Error('usage: balto.mjs <action> <data-dir> <resources-dir>')

const dataRoot = resolve(dataRootArg)
const resources = resolve(resourcesArg)
const runtimeRoot = join(dataRoot, 'runtime')
const dshRoot = join(runtimeRoot, 'dsh')
const dshHome = join(dataRoot, 'home')
const pidRoot = join(dataRoot, 'pids')
const modelRoot = join(dataRoot, 'models')
const cacheRoot = join(dataRoot, 'cache')
const venvRoot = join(runtimeRoot, 'mtplx')
const workspaceRoot = join(homedir(), 'Balto')
const statePath = join(dataRoot, 'state.json')
const logPath = join(dataRoot, 'balto.log')
const actionPidPath = join(pidRoot, 'action.pid')
const nodeBin = join(resources, 'node', 'bin', 'node')
const npmCli = join(resources, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
const uvBin = join(resources, 'uv', 'uv')
const mtplxBin = join(venvRoot, 'bin', 'mtplx')
const dshEntry = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const modelRepo = 'hashtofu/Qwen3.8-27B-MTPLX-4bit'
const modelFolder = 'hashtofu--Qwen3.8-27B-MTPLX-4bit'
const ownModelPath = join(modelRoot, modelFolder)
const legacyModelPath = join(homedir(), '.mtplx', 'models', modelFolder)
const servedModel = 'balto-qwen-3.8-27b'
const enginePort = 30000
const gatewayPort = 30100
const workspacePort = 3080
const visionDownloadBytes = 921_460_192
const downloadTotalBytes = 16_924_103_741

await Promise.all([
  mkdir(dataRoot, { recursive: true }),
  mkdir(runtimeRoot, { recursive: true }),
  mkdir(dshHome, { recursive: true }),
  mkdir(pidRoot, { recursive: true }),
  mkdir(modelRoot, { recursive: true }),
  mkdir(cacheRoot, { recursive: true }),
  mkdir(workspaceRoot, { recursive: true }),
])

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 })
}

function defaultState() {
  return {
    phase: 'not-installed',
    stage: 'system-check',
    message: 'Ready to prepare Balto on this Mac.',
    progress: 0,
    startedAt: null,
    downloadedGb: null,
    downloadTotalGb: Number((downloadTotalBytes / 1e9).toFixed(1)),
    downloadRateMbps: null,
    etaSeconds: null,
    gpuName: null,
    gpuMemoryMib: null,
    gpuMemoryUsedMib: null,
    dockerInstalled: false,
    dockerReady: false,
    tailscaleInstalled: false,
    tailscaleSignedIn: false,
    tailscaleDnsName: null,
    remoteEnabled: false,
    remoteUrl: null,
    inferenceReady: false,
    workspaceReady: false,
    contextWindow: null,
    warning: null,
    updatedAt: null,
  }
}

async function readState() {
  try {
    return { ...defaultState(), ...JSON.parse(await readFile(statePath, 'utf8')) }
  } catch {
    return defaultState()
  }
}

async function updateState(values) {
  const state = { ...(await readState()), ...values, updatedAt: new Date().toISOString() }
  const temporary = `${statePath}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, statePath)
  return state
}

function commandOutput(command, args = []) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function hardware() {
  const arch = commandOutput('/usr/bin/uname', ['-m'])
  const osVersion = commandOutput('/usr/bin/sw_vers', ['-productVersion'])
  const osMajor = Number(osVersion.split('.')[0])
  const memoryBytes = Number(commandOutput('/usr/sbin/sysctl', ['-n', 'hw.memsize']))
  let chip = 'Apple Silicon'
  try {
    const profile = JSON.parse(commandOutput('/usr/sbin/system_profiler', ['SPHardwareDataType', '-json']))
    const row = profile.SPHardwareDataType?.[0] || {}
    chip = row.chip_type || row.cpu_type || chip
  } catch {}
  const memoryMib = Math.round(memoryBytes / 1024 / 1024)
  const memoryGib = memoryBytes / 1024 / 1024 / 1024
  const contextWindow = memoryGib >= 96 ? 262144 : memoryGib >= 64 ? 131072 : memoryGib >= 48 ? 65536 : 32768
  const disk = statfsSync(dataRoot)
  const freeBytes = Number(disk.bavail) * Number(disk.bsize)
  return { arch, osVersion, osMajor, memoryBytes, memoryMib, memoryGib, contextWindow, chip, freeBytes }
}

async function assertCompatible() {
  const info = hardware()
  await updateState({
    gpuName: info.chip,
    gpuMemoryMib: info.memoryMib,
    contextWindow: info.contextWindow,
  })
  if (info.arch !== 'arm64') throw new Error('Balto requires an Apple Silicon Mac.')
  if (!Number.isFinite(info.osMajor) || info.osMajor < 14) throw new Error('Balto requires macOS 14 Sonoma or newer.')
  if (info.memoryGib < 31) throw new Error('Qwen 3.8 27B requires at least 32 GB of unified memory. 48 GB or more is recommended.')
  if (info.freeBytes < 28 * 1024 ** 3 && !validModelPath()) throw new Error('Balto needs at least 28 GB of free storage for its runtime and model.')
  return info
}

function validModelAt(path) {
  return existsSync(join(path, 'mtplx_runtime.json')) && existsSync(join(path, 'config.json'))
}

function validModelPath() {
  if (validModelAt(ownModelPath)) return ownModelPath
  if (validModelAt(legacyModelPath)) return legacyModelPath
  return null
}

function childAlive(name) {
  const path = join(pidRoot, `${name}.pid`)
  try {
    const pid = Number(readFileSync(path, 'utf8').trim())
    process.kill(pid, 0)
    return pid
  } catch {
    return 0
  }
}

async function endpointReady(url, timeout = 1200) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}

async function refreshStatus({ preservePhase = false } = {}) {
  const current = await readState()
  let info
  try { info = hardware() } catch {}
  const inferenceReady = Boolean(childAlive('engine')) && await endpointReady(`http://127.0.0.1:${enginePort}/health`)
  const gatewayReady = Boolean(childAlive('gateway')) && await endpointReady(`http://127.0.0.1:${gatewayPort}/health`)
  const workspaceReady = gatewayReady && Boolean(childAlive('workspace')) && await endpointReady(`http://127.0.0.1:${workspacePort}/`)
  const runtimeInstalled = existsSync(mtplxBin) && existsSync(dshEntry)
  const values = {
    gpuName: info?.chip || current.gpuName,
    gpuMemoryMib: info?.memoryMib || current.gpuMemoryMib,
    contextWindow: info?.contextWindow || current.contextWindow,
    dockerInstalled: runtimeInstalled,
    dockerReady: runtimeInstalled,
    inferenceReady,
    workspaceReady,
  }
  if (!preservePhase) {
    if (inferenceReady && workspaceReady) Object.assign(values, { phase: 'ready', stage: 'ready', progress: 100, message: 'Qwen 3.8 27B and the Balto coding workspace are ready.', warning: null })
    else if (current.phase === 'ready') Object.assign(values, { phase: 'degraded', stage: 'launch', message: 'Balto is restarting a local service.' })
  }
  return updateState(values)
}

async function run(command, args, { cwd, env, prefix = 'command' } = {}) {
  log(`${prefix}: ${command} ${args.join(' ')}`)
  const result = await execFileAsync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  })
  for (const stream of [result.stdout, result.stderr]) {
    for (const line of String(stream || '').split(/\r?\n/)) if (line.trim()) log(`${prefix}: ${line}`)
  }
  return result
}

async function ensureEngineRuntime() {
  if (existsSync(mtplxBin)) return
  await updateState({ phase: 'downloading-runtime', stage: 'engine', progress: 18, message: 'Installing Balto\'s private Apple Silicon engine.' })
  const env = {
    UV_CACHE_DIR: join(cacheRoot, 'uv'),
    UV_PYTHON_INSTALL_DIR: join(runtimeRoot, 'python'),
  }
  await run(uvBin, ['venv', '--python', '3.12', '--python-preference', 'only-managed', venvRoot], { env, prefix: 'python' })
  await run(uvBin, ['pip', 'install', '--python', join(venvRoot, 'bin', 'python'), 'mtplx==2.6.0'], { env, prefix: 'engine install' })
  if (!existsSync(mtplxBin)) throw new Error('The Balto inference engine did not install correctly.')
}

async function ensureWorkspaceRuntime(info) {
  if (!existsSync(dshEntry)) {
    await updateState({ phase: 'downloading-runtime', stage: 'app-runtime', progress: 30, message: 'Installing the Balto coding workspace and tools.' })
    await run(nodeBin, [npmCli, 'install', '--cache', join(cacheRoot, 'npm'), '--prefix', dshRoot, '@deepseek-ai/dsh@0.1.0-rc.6', 'js-yaml@4.2.0', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
      env: {
        PATH: `${dirname(nodeBin)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        npm_config_arch: 'arm64',
        npm_config_target_arch: 'arm64',
      },
      prefix: 'workspace install',
    })
  }
  if (!existsSync(dshEntry)) throw new Error('The Balto coding workspace did not install correctly.')
  await run(nodeBin, [join(resources, 'patch-dsh.mjs'), dshRoot, resources], { prefix: 'workspace brand' })
  const settingsPath = join(dshHome, 'settings.yaml')
  if (!existsSync(settingsPath)) {
    const template = await readFile(join(resources, 'templates', 'settings.yaml'), 'utf8')
    await writeFile(settingsPath, template.replaceAll('262144', String(info.contextWindow)), { mode: 0o600 })
  }
  const webProfileRoot = join(dshHome, 'profiles', 'web')
  await mkdir(webProfileRoot, { recursive: true })
  const webProfileFiles = {
    'cordis.yml': '[]\n',
    'cordis.patch.yml': '# Balto preserves user overrides in this profile layer.\n[]\n',
    'package.json': `${JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }, null, 2)}\n`,
    'pnpm-workspace.yaml': 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  }
  for (const [name, body] of Object.entries(webProfileFiles)) {
    const path = join(webProfileRoot, name)
    if (!existsSync(path)) await writeFile(path, body, { mode: 0o600 })
  }
  await run(nodeBin, [join(resources, 'ensure-workspace.mjs'), join(dshHome, 'storages', 'workspace.json'), workspaceRoot], { prefix: 'workspace registry' })
}

async function pullModel() {
  const existing = validModelPath()
  if (existing) {
    log(`Reusing the verified Qwen 3.8 model at ${existing}`)
    await updateState({ downloadedGb: Number(((downloadTotalBytes - visionDownloadBytes) / 1e9).toFixed(1)), progress: 82, message: 'The optimized Qwen 3.8 27B language model is ready.' })
    return ensureVisionModel(existing)
  }
  await updateState({ phase: 'downloading-model', stage: 'model', progress: 42, message: 'Downloading the optimized Qwen 3.8 27B model. Downloads resume automatically.' })
  const child = spawn(mtplxBin, ['pull', modelRepo, '--cache-dir', modelRoot, '--progress-json'], {
    env: engineEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let pending = ''
  let lastBytes = 0
  let lastTime = Date.now()
  const consume = async (chunk) => {
    pending += chunk.toString('utf8')
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() || ''
    for (const line of lines) {
      log(`model: ${line}`)
      try {
        const event = JSON.parse(line)
        const bytes = Number(event.size_bytes ?? event.downloaded_bytes ?? event.completed_bytes ?? 0)
        const total = Number(event.total_bytes || downloadTotalBytes)
        if (bytes <= 0) continue
        const now = Date.now()
        const seconds = Math.max((now - lastTime) / 1000, 0.001)
        const rate = Math.max(bytes - lastBytes, 0) / seconds
        const progress = Math.max(42, Math.min(82, 42 + Math.round((bytes / total) * 40)))
        await updateState({
          phase: 'downloading-model',
          stage: 'model',
          progress,
          downloadedGb: Number((bytes / 1e9).toFixed(2)),
          downloadTotalGb: Number((total / 1e9).toFixed(1)),
          downloadRateMbps: rate > 0 ? Number((rate / 1e6).toFixed(1)) : null,
          etaSeconds: rate > 0 ? Math.ceil((total - bytes) / rate) : null,
          message: 'Downloading Qwen 3.8 27B. Completed files are saved and interrupted downloads resume.',
        })
        lastBytes = bytes
        lastTime = now
      } catch {}
    }
  }
  let progressUpdates = Promise.resolve()
  child.stdout.on('data', (chunk) => { progressUpdates = progressUpdates.then(() => consume(chunk)) })
  child.stderr.on('data', (chunk) => { for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) log(`model: ${line}`) })
  const exitCode = await new Promise((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolveCode(code))
  })
  await progressUpdates
  if (pending.trim()) await consume(Buffer.from('\n'))
  if (exitCode !== 0 || !validModelAt(ownModelPath)) throw new Error(`The Qwen model download stopped with code ${exitCode}. Balto preserved completed files for retry.`)
  return ensureVisionModel(ownModelPath)
}

async function ensureOwnModel(basePath) {
  if (resolve(basePath) === resolve(ownModelPath)) return ownModelPath
  await updateState({ phase: 'installing', stage: 'vision', progress: 82, message: 'Preparing Balto\'s private Qwen 3.8 model copy.' })
  await mkdir(ownModelPath, { recursive: true })
  for (const entry of await readdir(basePath, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    await copyFile(join(basePath, entry.name), join(ownModelPath, entry.name), constants.COPYFILE_FICLONE)
  }
  return ownModelPath
}

async function ensureVisionModel(basePath) {
  const modelPath = await ensureOwnModel(basePath)
  await updateState({ phase: 'downloading-model', stage: 'vision', progress: 83, message: 'Adding Qwen 3.8\'s native vision tower. This download also resumes automatically.' })
  const child = spawn(nodeBin, [join(resources, 'install-vision.mjs'), modelPath], {
    env: engineEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let pending = ''
  let progressUpdates = Promise.resolve()
  const consume = async (chunk) => {
    pending += chunk.toString('utf8')
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      log(`vision: ${line}`)
      try {
        const event = JSON.parse(line)
        const percent = Number(event.percent || 0)
        const bytes = Number(event.downloadedBytes || 0)
        await updateState({
          phase: 'downloading-model',
          stage: 'vision',
          progress: Math.max(83, Math.min(89, 83 + Math.round(percent * 0.06))),
          downloadedGb: Number(((downloadTotalBytes - visionDownloadBytes + bytes) / 1e9).toFixed(2)),
          message: percent >= 100 ? 'Qwen 3.8 text and vision are ready.' : 'Adding Qwen 3.8 vision. Completed tensors are saved and interrupted downloads resume.',
        })
      } catch {}
    }
  }
  child.stdout.on('data', (chunk) => { progressUpdates = progressUpdates.then(() => consume(chunk)) })
  child.stderr.on('data', (chunk) => { for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) log(`vision: ${line}`) })
  const exitCode = await new Promise((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolveCode(code))
  })
  await progressUpdates
  if (pending.trim()) await consume(Buffer.from('\n'))
  if (exitCode !== 0 || !existsSync(join(modelPath, 'vision.safetensors'))) {
    throw new Error(`Qwen 3.8 vision setup stopped with code ${exitCode}. Balto preserved completed tensors for retry.`)
  }
  return modelPath
}

function engineEnvironment() {
  return {
    ...process.env,
    HF_HOME: modelRoot,
    HF_HUB_CACHE: modelRoot,
    UV_CACHE_DIR: join(cacheRoot, 'uv'),
    MTPLX_STATS_FOOTER_SCOPE: 'owned',
    PYTHONUNBUFFERED: '1',
    BALTO_SPEEDRUNNER: '1',
  }
}

async function startDetached(name, command, args, { cwd, env } = {}) {
  if (childAlive(name)) return
  const out = openSync(join(dataRoot, `${name}.out.log`), 'a', 0o600)
  const err = openSync(join(dataRoot, `${name}.err.log`), 'a', 0o600)
  let child
  try {
    const childEnvironment = { ...process.env, ...env }
    if (cwd) childEnvironment.PWD = cwd
    child = spawn(command, args, {
      cwd,
      env: childEnvironment,
      detached: true,
      stdio: ['ignore', out, err],
    })
  } finally {
    closeSync(out)
    closeSync(err)
  }
  child.unref()
  await writeFile(join(pidRoot, `${name}.pid`), `${child.pid}\n`, { mode: 0o600 })
  log(`Started ${name} as process group ${child.pid}`)
}

async function stopProcess(name) {
  const pidPath = join(pidRoot, `${name}.pid`)
  const pid = childAlive(name)
  if (pid) {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
      try { process.kill(pid, 0) } catch { break }
    }
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
    log(`Stopped ${name} process group ${pid}`)
  }
  await unlink(pidPath).catch(() => {})
}

async function waitFor(url, attempts, message) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await endpointReady(url, 1500)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
  }
  throw new Error(message)
}

async function startEngine(modelPath, info) {
  if (await endpointReady(`http://127.0.0.1:${enginePort}/health`)) return
  await updateState({ phase: 'starting', stage: 'launch', progress: 90, message: 'Loading Qwen 3.8 27B into unified memory.' })
  await startDetached('engine', mtplxBin, [
    'serve', '--model', modelPath, '--model-id', servedModel,
    '--host', '127.0.0.1', '--port', String(enginePort), '--no-auth',
    '--profile', 'turbo', '--generation-mode', 'mtp', '--depth', '3',
    '--draft-temperature', '0.70', '--draft-top-p', '0.95', '--draft-top-k', '20',
    '--batching-preset', 'agent', '--ssd-session-cache', 'on',
    '--ssd-session-cache-dir', join(cacheRoot, 'sessions'),
    '--reasoning', 'off', '--preserve-thinking', 'scoped', '--tool-prompt-mode', 'native',
    '--fan-mode', 'default', '--context-window', String(info.contextWindow), '--max-tokens', '32768',
    '--app-launch-id', `balto-${process.ppid}`,
  ], { env: engineEnvironment() })
  await waitFor(`http://127.0.0.1:${enginePort}/health`, 300, 'Qwen did not finish loading. Balto preserved the model and will resume on the next launch.')
}

async function writeProfilePatch() {
  const generated = join(dataRoot, 'profile.patch.yml')
  const publicWebScript = join(dshRoot, 'balto-tools-mcp.mjs')
  await copyFile(join(resources, 'balto-tools-mcp.mjs'), publicWebScript)
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
  const body = `# Balto owns this generated deployment layer.\n- id: llm-deepseek\n  disabled: true\n- id: web-search-deepseek\n  disabled: true\n- id: tool-web\n  disabled: true\n- insert:\n    - id: mcp-balto-tools\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: balto\n        transport: stdio\n        command: ${quote(nodeBin)}\n        args: [${quote(publicWebScript)}]\n        env:\n          BALTO_WORKSPACE: ${quote(workspaceRoot)}\n        failOnStartupError: true\n        toolCallTimeoutMs: 60000\n`
  await writeFile(generated, body, { mode: 0o600 })
  return generated
}

async function startLocalServices() {
  await updateState({ phase: 'starting', stage: 'launch', progress: 96, message: 'Starting the Balto coding workspace and local tools.' })
  await startDetached('gateway', nodeBin, [join(resources, 'gateway.mjs')], {
    env: { BALTO_GATEWAY_PORT: String(gatewayPort), BALTO_INFERENCE_URL: `http://127.0.0.1:${enginePort}` },
  })
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`, 30, 'The Balto model gateway did not start.')
  const profilePatch = await writeProfilePatch()
  await startDetached('workspace', nodeBin, [dshEntry, '--profile', 'web', '--patch', profilePatch, '--host', '127.0.0.1', '--port', String(workspacePort)], {
    cwd: workspaceRoot,
    env: { DSH_HOME: dshHome, PATH: `${dirname(nodeBin)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` },
  })
  await waitFor(`http://127.0.0.1:${workspacePort}/`, 90, 'The Balto coding workspace did not start.')
}

async function installAndStart() {
  const startedAt = new Date().toISOString()
  await updateState({ phase: 'installing', stage: 'system-check', progress: 8, message: 'Checking Apple Silicon, unified memory, and storage.', warning: null, startedAt })
  const info = await assertCompatible()
  await ensureEngineRuntime()
  await ensureWorkspaceRuntime(info)
  const modelPath = await pullModel()
  await startEngine(modelPath, info)
  await startLocalServices()
  await updateState({ phase: 'ready', stage: 'ready', progress: 100, message: 'Qwen 3.8 27B and the Balto coding workspace are ready.', inferenceReady: true, workspaceReady: true, etaSeconds: 0, warning: null })
}

async function stopEverything() {
  await updateState({ phase: 'stopping', stage: 'launch', progress: 95, message: 'Stopping Balto and every process it started.' })
  const currentAction = (() => { try { return Number(readFileSync(actionPidPath, 'utf8').trim()) } catch { return 0 } })()
  if (currentAction && currentAction !== process.pid) {
    try { process.kill(-currentAction, 'SIGTERM') } catch { try { process.kill(currentAction, 'SIGTERM') } catch {} }
  }
  await stopProcess('workspace')
  await stopProcess('gateway')
  await stopProcess('engine')
  await updateState({ phase: 'stopped', stage: 'launch', progress: 0, message: 'Balto is stopped. The model remains cached for the next launch.', inferenceReady: false, workspaceReady: false, warning: null })
}

async function main() {
  log(`Action started: ${action}`)
  if (action !== 'stop') await writeFile(actionPidPath, `${process.pid}\n`, { mode: 0o600 })
  try {
    if (action === 'status') await refreshStatus()
    else if (action === 'setup') await installAndStart()
    else if (action === 'start') {
      const info = await assertCompatible()
      await ensureEngineRuntime()
      await ensureWorkspaceRuntime(info)
      const modelPath = await pullModel()
      await startEngine(modelPath, info)
      await startLocalServices()
      await refreshStatus()
    } else if (action === 'stop') await stopEverything()
    else throw new Error(`Unknown Balto action: ${action}`)
    log(`Action completed: ${action}`)
  } catch (error) {
    const message = error?.message || String(error)
    log(`Action failed: ${action}: ${message}\n${error?.stack || ''}`)
    if (action !== 'stop') await updateState({ phase: 'failed', message, warning: message })
    process.exitCode = 1
  } finally {
    if (action !== 'stop') {
      await unlink(actionPidPath).catch(() => {})
    }
  }
}

await main()
