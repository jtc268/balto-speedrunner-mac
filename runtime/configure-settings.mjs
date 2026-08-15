import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [settingsPath, templatePath, yamlModulePath, contextWindow = '262144'] = process.argv.slice(2)
if (!settingsPath || !templatePath || !yamlModulePath) {
  throw new Error('usage: configure-settings.mjs <settings> <template> <js-yaml-module> [context-window]')
}

const yaml = await import(pathToFileURL(yamlModulePath).href)
const templateBody = (await readFile(templatePath, 'utf8')).replaceAll('262144', String(contextWindow))
const template = yaml.load(templateBody)
let settings
try {
  settings = yaml.load(await readFile(settingsPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  settings = {}
}

settings ||= {}
const managedDefaultModel = template['agent-default-model']
const currentDefaultModel = settings['agent-default-model']
if (!currentDefaultModel || currentDefaultModel.provider === 'balto' || currentDefaultModel.model === 'balto-qwen-3.8-27b') {
  settings['agent-default-model'] = { ...currentDefaultModel, ...managedDefaultModel }
}
settings.permission ||= template.permission
settings['llm-pi-ai'] ||= {}
settings['llm-pi-ai'].providers ||= {}

const managedProvider = template['llm-pi-ai'].providers.balto
const currentProvider = settings['llm-pi-ai'].providers.balto || {}
const currentModels = Array.isArray(currentProvider.models) ? currentProvider.models : []
const managedModel = managedProvider.models[0]
const managedModelIndex = currentModels.findIndex((model) => model?.id === managedModel.id)
const models = [...currentModels]
if (managedModelIndex === -1) models.unshift(managedModel)
else models[managedModelIndex] = { ...models[managedModelIndex], ...managedModel }

settings['llm-pi-ai'].providers.balto = {
  ...currentProvider,
  ...managedProvider,
  models,
}

await writeFile(settingsPath, yaml.dump(settings, { lineWidth: 120, noRefs: true }), 'utf8')
