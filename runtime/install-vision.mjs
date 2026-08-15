import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const [modelDirArg] = process.argv.slice(2)
if (!modelDirArg) throw new Error('usage: install-vision.mjs <model-dir>')

const modelDir = resolve(modelDirArg)
const revision = '3e6447f082e89cc7f0bc6e5441afd38dfce760ff'
const repoBase = `https://huggingface.co/mlx-community/Qwen3.8-27B-4bit/resolve/${revision}`
const shardUrl = `${repoBase}/model-00001-of-00003.safetensors`
const outputPath = join(modelDir, 'vision.safetensors')
const partialPath = `${outputPath}.partial`
const progressPath = `${outputPath}.progress.json`
const headerFingerprintPath = `${outputPath}.header.sha256`
const minimumVisionBytes = 900_000_000

await mkdir(modelDir, { recursive: true })

async function fetchWithRetry(url, options = {}, attempts = 5) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: 'follow',
        signal: AbortSignal.timeout(180_000),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolveWait) => setTimeout(resolveWait, 500 * attempt))
    }
  }
  throw new Error(`Could not download ${basename(new URL(url).pathname)}: ${lastError?.message || lastError}`)
}

async function fetchRange(start, end) {
  const response = await fetchWithRetry(shardUrl, { headers: { range: `bytes=${start}-${end}` } })
  if (response.status !== 206) throw new Error(`Vision source ignored byte range ${start}-${end}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const expected = end - start + 1
  if (bytes.length !== expected) throw new Error(`Vision range ${start}-${end} returned ${bytes.length} of ${expected} bytes`)
  return bytes
}

async function readSourceHeader() {
  const lengthBytes = await fetchRange(0, 7)
  const headerLength = Number(lengthBytes.readBigUInt64LE(0))
  if (!Number.isSafeInteger(headerLength) || headerLength < 2 || headerLength > 16 * 1024 * 1024) {
    throw new Error(`Invalid source safetensors header length: ${headerLength}`)
  }
  const headerBytes = await fetchRange(8, 8 + headerLength - 1)
  return { headerLength, header: JSON.parse(headerBytes.toString('utf8').trim()) }
}

function createVisionHeader(sourceHeader) {
  const entries = Object.entries(sourceHeader)
    .filter(([name, value]) => name.startsWith('vision_tower.') && value?.data_offsets)
    .sort((left, right) => left[1].data_offsets[0] - right[1].data_offsets[0])
  if (entries.length < 300) throw new Error(`Expected the Qwen vision tower, found only ${entries.length} tensors`)

  let cursor = 0
  const header = {
    __metadata__: {
      format: 'pt',
      source: 'mlx-community/Qwen3.8-27B-4bit',
      revision,
    },
  }
  const tensors = entries.map(([name, value]) => {
    const [sourceStart, sourceEnd] = value.data_offsets.map(Number)
    const length = sourceEnd - sourceStart
    const targetStart = cursor
    const targetEnd = cursor + length
    cursor = targetEnd
    header[name] = { dtype: value.dtype, shape: value.shape, data_offsets: [targetStart, targetEnd] }
    return { name, sourceStart, sourceEnd, targetStart, targetEnd, length }
  })

  const raw = Buffer.from(JSON.stringify(header), 'utf8')
  const paddedLength = Math.ceil(raw.length / 8) * 8
  const padded = Buffer.alloc(paddedLength, 0x20)
  raw.copy(padded)
  const prefix = Buffer.alloc(8)
  prefix.writeBigUInt64LE(BigInt(paddedLength))
  return {
    tensors,
    dataBytes: cursor,
    dataOffset: 8 + paddedLength,
    fileHeader: Buffer.concat([prefix, padded]),
    fingerprint: createHash('sha256').update(padded).digest('hex'),
  }
}

async function visionAlreadyInstalled() {
  try {
    const [output, config, index] = await Promise.all([
      stat(outputPath),
      readFile(join(modelDir, 'config.json'), 'utf8').then(JSON.parse),
      readFile(join(modelDir, 'model.safetensors.index.json'), 'utf8').then(JSON.parse),
    ])
    return output.size >= minimumVisionBytes && config.vision_config && Object.values(index.weight_map || {}).includes('vision.safetensors')
  } catch {
    return false
  }
}

async function installModelMetadata(visionBytes) {
  const sourceConfig = await fetchWithRetry(`${repoBase}/config.json`).then((response) => response.json())
  const configPath = join(modelDir, 'config.json')
  const indexPath = join(modelDir, 'model.safetensors.index.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  config.vision_config = sourceConfig.vision_config
  for (const key of ['image_token_id', 'video_token_id', 'vision_start_token_id', 'vision_end_token_id']) {
    if (sourceConfig[key] !== undefined) config[key] = sourceConfig[key]
  }

  const sourceIndex = await fetchWithRetry(`${repoBase}/model.safetensors.index.json`).then((response) => response.json())
  for (const name of Object.keys(sourceIndex.weight_map || {})) {
    if (name.startsWith('vision_tower.')) index.weight_map[name] = 'vision.safetensors'
  }
  index.metadata ||= {}
  index.metadata.total_size = Number(index.metadata.total_size || 0) + visionBytes

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 })
  for (const filename of ['preprocessor_config.json', 'processor_config.json', 'video_preprocessor_config.json']) {
    const bytes = Buffer.from(await (await fetchWithRetry(`${repoBase}/${filename}`)).arrayBuffer())
    await writeFile(join(modelDir, filename), bytes, { mode: 0o600 })
  }
}

if (await visionAlreadyInstalled()) {
  process.stdout.write(`${JSON.stringify({ phase: 'complete', percent: 100, message: 'Qwen 3.8 vision is ready.' })}\n`)
  process.exit(0)
}

const { headerLength: sourceHeaderLength, header: sourceHeader } = await readSourceHeader()
const plan = createVisionHeader(sourceHeader)
const sourceDataOffset = 8 + sourceHeaderLength
const targetBytes = plan.dataOffset + plan.dataBytes

let completed = new Set()
let reusablePartial = false
try {
  const [savedProgress, savedFingerprint, partial] = await Promise.all([
    readFile(progressPath, 'utf8').then(JSON.parse),
    readFile(headerFingerprintPath, 'utf8'),
    stat(partialPath),
  ])
  reusablePartial = savedProgress.revision === revision && savedFingerprint.trim() === plan.fingerprint && partial.size === targetBytes
  if (reusablePartial) completed = new Set(savedProgress.completed || [])
} catch {}

const output = await open(partialPath, reusablePartial ? 'r+' : 'w+', 0o600)
if (!reusablePartial) {
  await output.truncate(targetBytes)
  await output.write(plan.fileHeader, 0, plan.fileHeader.length, 0)
  await writeFile(headerFingerprintPath, `${plan.fingerprint}\n`, { mode: 0o600 })
}

let downloadedBytes = plan.tensors.filter((tensor) => completed.has(tensor.name)).reduce((sum, tensor) => sum + tensor.length, 0)
let lastReported = -1
let progressWrite = Promise.resolve()
function report() {
  const percent = Math.floor((downloadedBytes / plan.dataBytes) * 100)
  if (percent === lastReported) return
  lastReported = percent
  process.stdout.write(`${JSON.stringify({ phase: 'vision', percent, downloadedBytes, totalBytes: plan.dataBytes })}\n`)
}
function saveProgress() {
  const temporary = `${progressPath}.tmp`
  progressWrite = progressWrite.then(async () => {
    await writeFile(temporary, `${JSON.stringify({ revision, completed: [...completed] })}\n`, { mode: 0o600 })
    await rename(temporary, progressPath)
  })
  return progressWrite
}

report()
let nextTensor = 0
async function worker() {
  while (nextTensor < plan.tensors.length) {
    const tensor = plan.tensors[nextTensor]
    nextTensor += 1
    if (completed.has(tensor.name)) continue
    const bytes = await fetchRange(sourceDataOffset + tensor.sourceStart, sourceDataOffset + tensor.sourceEnd - 1)
    await output.write(bytes, 0, bytes.length, plan.dataOffset + tensor.targetStart)
    completed.add(tensor.name)
    downloadedBytes += bytes.length
    report()
    if (completed.size % 8 === 0) await saveProgress()
  }
}

try {
  await Promise.all(Array.from({ length: 6 }, () => worker()))
  await saveProgress()
  await output.sync()
} finally {
  await output.close()
}

await rename(partialPath, outputPath)
await installModelMetadata(plan.dataBytes)
await Promise.all([unlink(progressPath).catch(() => {}), unlink(headerFingerprintPath).catch(() => {})])
process.stdout.write(`${JSON.stringify({ phase: 'complete', percent: 100, downloadedBytes: plan.dataBytes, totalBytes: plan.dataBytes })}\n`)
