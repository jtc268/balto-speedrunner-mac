import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const defaultDataRoot = join(homedir(), 'Library', 'Application Support', 'com.adore.balto-speedrunner.mac')
const dataRoot = process.argv[2] || defaultDataRoot
const dshRoot = join(dataRoot, 'runtime', 'dsh')
const settingsPath = join(dataRoot, 'home', 'settings.yaml')
const profilePath = join(dataRoot, 'profile.patch.yml')
const driverPath = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-goal-round-driver', 'lib', 'index.js')
const yamlPath = join(dshRoot, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function profileEntry(profile, id) {
  return profile.find((entry) => entry?.id === id)
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function verifyMaxTokenContinuation(driverModule) {
  const listeners = new Map()
  const effects = []
  const warnings = []
  const followups = []
  let flushes = 0
  let disarms = 0

  const session = { id: 'long-run-audit' }
  const goal = {
    id: 'goal-audit',
    revision: 1,
    objective: 'Verify long-running continuation.',
    phase: 'active',
    activation: 'armed',
    roundsStarted: 0,
    maxGoalRounds: 256,
  }
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    inbox: {
      nextStep: [],
      nextTurn: [],
      prepend() {},
    },
    followup(message) {
      followups.push(message)
    },
  }

  const emit = (name, ...args) => {
    for (const listener of listeners.get(name) || []) listener(...args)
  }
  const context = {
    fiber: { state: 2 },
    logger: { warn: (message) => warnings.push(String(message)) },
    agents: {
      get: (id) => id === agent.id ? agent : undefined,
      list: () => [],
      withoutInitiator: (callback) => Promise.resolve().then(callback),
    },
    goals: {
      get: (candidate) => candidate === agent ? goal : undefined,
      disarm: () => { disarms += 1 },
      pause: () => { goal.phase = 'paused' },
      block: () => { goal.phase = 'blocked' },
    },
    sessions: {
      flush: async () => { flushes += 1 },
    },
    on(name, listener) {
      const bucket = listeners.get(name) || []
      bucket.push(listener)
      listeners.set(name, bucket)
    },
    effect(factory) {
      const iterator = factory()
      effects.push(iterator.next().value)
    },
  }

  driverModule.apply(context)
  emit('agent/created', { agent })
  emit('goal/changed', { agent })
  await waitUntil(() => followups.length === 1, 'the first goal round')

  const first = followups[0]
  assert.equal(first.source.kind, 'goal')
  assert.equal(first.source.round, 1)
  agent.status = 'running'
  emit('session/event', session, { type: 'user/message', data: { id: first.id } })
  goal.roundsStarted = 1
  emit('session/event', session, { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(followups.length, 1, 'a running turn must not queue a competing round')

  agent.status = 'idle'
  emit('agent/status', { agent, status: 'idle' })
  await waitUntil(() => followups.length === 2, 'continuation after max tokens')

  const second = followups[1]
  assert.equal(second.source.kind, 'goal')
  assert.equal(second.source.round, 2)
  assert.ok(flushes >= 2, `expected durability checkpoints, saw ${flushes}`)
  assert.equal(disarms, 0, 'max-token continuation must not disarm the active goal')
  assert.deepEqual(warnings, [])

  for (const cleanup of effects) if (typeof cleanup === 'function') await cleanup()
  return { nextRound: second.source.round, durabilityFlushes: flushes }
}

for (const path of [settingsPath, profilePath, driverPath, yamlPath]) {
  assert.equal(await exists(path), true, `Missing installed runtime file: ${path}`)
}

const yaml = await import(pathToFileURL(yamlPath).href)
const settings = yaml.load(await readFile(settingsPath, 'utf8'))
const profile = yaml.load(await readFile(profilePath, 'utf8'))
assert.ok(Array.isArray(profile), 'profile.patch.yml must contain a plugin list')

const provider = settings?.['llm-pi-ai']?.providers?.balto
const model = provider?.models?.find((candidate) => candidate?.id === 'balto-qwen-3.8-27b')
assert.ok(provider, 'Balto provider is missing')
assert.ok(model, 'Balto Qwen 3.8 model is missing')
assert.ok(Number(model.contextWindow) >= 32768, 'Context window is below the supported minimum')
assert.equal(Number(model.maxTokens), 32768)
assert.equal(settings?.['agent-default-model']?.reasoningEffort, 'medium')
assert.ok(Number(provider?.retryPolicy?.maxRetries) >= 5, 'Transient request retry budget is too small')

const compaction = profileEntry(profile, 'compaction-basic')
const policy = compaction?.config?.modelPolicies?.find((candidate) =>
  candidate?.provider === 'balto' && candidate?.model === 'balto-qwen-3.8-27b')
assert.equal(compaction?.disabled, false)
assert.ok(policy, 'Balto compaction policy is missing')
assert.equal(policy.thresholdRatio, 0.45)
assert.equal(policy.retainTokens, 12000)
assert.equal(policy.maxTokens, 4096)
assert.ok(policy.compactionRetries >= 2)
assert.ok(policy.maxOverflowRetries >= 3)
assert.equal(profileEntry(profile, 'tool-result-pruner')?.disabled, false)
assert.equal(profileEntry(profile, 'tool-goal')?.disabled, false)

const driver = await import(`${pathToFileURL(driverPath).href}?audit=${Date.now()}`)
const continuation = await verifyMaxTokenContinuation(driver)
const thresholdTokens = Math.floor(Number(model.contextWindow) * policy.thresholdRatio)

console.log(JSON.stringify({
  ok: true,
  model: model.id,
  contextWindow: Number(model.contextWindow),
  compactionThresholdTokens: thresholdTokens,
  retainedTailTokens: policy.retainTokens,
  compactionRetries: policy.compactionRetries,
  overflowRetries: policy.maxOverflowRetries,
  requestRetries: Number(provider.retryPolicy.maxRetries),
  defaultGoalRounds: 256,
  maxTokenContinuation: continuation,
}, null, 2))
