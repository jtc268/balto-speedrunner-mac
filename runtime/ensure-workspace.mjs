import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const [statePath, workspacePath] = process.argv.slice(2)
if (!statePath || !workspacePath) throw new Error('usage: ensure-workspace.mjs <registry> <workspace>')

const canonicalWorkspace = resolve(workspacePath)
await mkdir(dirname(statePath), { recursive: true })
await mkdir(canonicalWorkspace, { recursive: true })

let state
try {
  state = JSON.parse(await readFile(statePath, 'utf8'))
} catch {
  state = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
    tables: { workspaces: {} },
  }
}

if (state?.unit?.name !== 'workspace' || state?.unit?.version !== 2) process.exit(0)
if (Object.values(state.tables?.workspaces || {}).some((entry) => resolve(entry.path) === canonicalWorkspace)) process.exit(0)

const id = randomUUID()
const now = new Date().toISOString()
state.global.initialized = true
state.global.workspaceIds = [id, ...(state.global.workspaceIds || [])]
state.global.archivedSessionIds ||= []
state.tables ||= {}
state.tables.workspaces ||= {}
state.tables.workspaces[id] = {
  path: canonicalWorkspace,
  title: 'Balto',
  sessionIds: [],
  createdAt: now,
  updatedAt: now,
}

const temporary = `${statePath}.tmp`
await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
await rename(temporary, statePath)
