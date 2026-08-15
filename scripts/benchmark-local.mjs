import { performance } from 'node:perf_hooks'

const endpoint = new URL('/v1/chat/completions', process.env.BALTO_ENGINE_URL || 'http://127.0.0.1:30000')
const prompt = `Continue this Python function with production-quality code and no prose:

from pathlib import Path
import json

def load_prompt_suite(path: Path) -> list[dict]:
    """Load a JSONL prompt suite and validate required fields."""
`

const lanes = [
  { label: 'AR', generation_mode: 'ar' },
  { label: 'D1', generation_mode: 'mtp', depth: 1 },
  { label: 'D2', generation_mode: 'mtp', depth: 2 },
  { label: 'D3', generation_mode: 'mtp', depth: 3 },
]

async function runLane(lane) {
  const { label, ...laneRequest } = lane
  const startedAt = performance.now()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'balto-qwen-3.8-27b',
      stream: false,
      max_tokens: 192,
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      seed: 0,
      messages: [{ role: 'user', content: prompt }],
      ...laneRequest,
    }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message || `Benchmark request failed with HTTP ${response.status}`)
  const elapsedSeconds = (performance.now() - startedAt) / 1000
  const completionTokens = Number(body.usage?.completion_tokens || 0)
  return {
    lane: label,
    completionTokens,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    tokensPerSecond: Number((completionTokens / elapsedSeconds).toFixed(1)),
  }
}

await fetch(new URL('/health', endpoint)).then((response) => {
  if (!response.ok) throw new Error('Balto is not running. Open the app and wait for Local stack ready.')
})

const rows = []
for (const lane of lanes) rows.push(await runLane(lane))
const baseline = rows[0].tokensPerSecond
for (const row of rows) row.relative = Number((row.tokensPerSecond / baseline).toFixed(2))
console.table(rows)
console.log(JSON.stringify({ endpoint: endpoint.toString(), sampling: 'temperature=.6 top_p=.95 top_k=20 seed=0', rows }, null, 2))
