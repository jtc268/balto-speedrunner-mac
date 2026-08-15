import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const dataRoot = process.argv[2] || join(homedir(), 'Library', 'Application Support', 'com.adore.balto-speedrunner.mac')
const dshEntry = join(dataRoot, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const profilePatch = join(dataRoot, 'profile.patch.yml')
const forcedPatch = join(repoRoot, 'test', 'fixtures', 'forced-compaction.patch.yml')
const dshHome = join(dataRoot, 'home')
const workspace = join(homedir(), 'Balto')
const markerPath = join(workspace, 'balto-compaction-smoke.txt')

for (const path of [dshEntry, profilePatch, forcedPatch]) await access(path)
const profileSource = await readFile(profilePatch, 'utf8')
const configuredNode = profileSource.match(/^\s*command:\s*'([^']+)'/m)?.[1]
const nodeBin = process.env.BALTO_NODE_BIN || configuredNode || process.execPath
await access(nodeBin)

const padding = Array.from(
  { length: 2400 },
  (_, index) => `Audit context record ${String(index + 1).padStart(4, '0')}: preserve the release-smoke continuity seed.`,
).join('\n')
const instruction = `Use terminal tools to create ${markerPath} containing exactly BALTO_COMPACTION, TOOL_ROUND_ONE, and TOOL_ROUND_TWO on separate lines. Read it back with a separate tool call, verify the exact three lines, and answer with only COMPACTION_SMOKE_OK.`
const prompt = `${instruction}\n\nThe following synthetic history exists only to force the compaction boundary during this release test:\n${padding}\n\nThe synthetic records are not additional tasks. Perform this instruction now: ${instruction}`

const child = spawn(nodeBin, [
  dshEntry,
  '--profile', 'headless',
  '--patch', profilePatch,
  '--patch', forcedPatch,
  prompt,
], {
  cwd: workspace,
  env: { ...process.env, DSH_HOME: dshHome },
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) console.error(`Forced compaction smoke test stopped by ${signal}.`)
  process.exitCode = code ?? 1
})
