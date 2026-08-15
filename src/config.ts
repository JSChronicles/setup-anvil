import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'

const MAX_CONFIG_BYTES = 5 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function extractConfigFiles(args: readonly string[]): string[] {
  const configFiles: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') break

    if (argument.startsWith('--config-file=')) {
      const value = argument.slice('--config-file='.length)
      if (!value) throw new Error('--config-file requires a path')
      configFiles.push(value)
      continue
    }

    if (argument !== '--config-file') continue

    let foundValue = false
    while (index + 1 < args.length) {
      const value = args[index + 1]
      if (value === '--' || value.startsWith('-')) break
      configFiles.push(value)
      foundValue = true
      index += 1
    }
    if (!foundValue) throw new Error('--config-file requires at least one path')
  }

  return configFiles
}

export async function discoverProviders(
  configFiles: readonly string[],
  cwd = process.cwd()
): Promise<string[]> {
  const providers = new Set<string>()

  for (const configFile of configFiles) {
    const absolutePath = resolve(cwd, configFile)
    let fileStats
    try {
      fileStats = await stat(absolutePath)
    } catch (error) {
      throw new Error(`Config file not found or unreadable: ${configFile}`, {
        cause: error
      })
    }
    if (!fileStats.isFile())
      throw new Error(`Config path is not a file: ${configFile}`)
    if (fileStats.size > MAX_CONFIG_BYTES) {
      throw new Error(
        `Config file exceeds the 5 MiB safety limit: ${configFile}`
      )
    }

    let contents: string
    try {
      contents = await readFile(absolutePath, 'utf8')
    } catch (error) {
      throw new Error(`Unable to read config file: ${configFile}`, {
        cause: error
      })
    }

    const document = parseDocument(contents, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true
    })
    if (document.errors.length > 0) {
      throw new Error(
        `Malformed YAML in ${configFile}: ${document.errors[0].message}`
      )
    }

    const config: unknown = document.toJS({ maxAliasCount: 100 })
    if (!isRecord(config))
      throw new Error(`Config must contain a YAML mapping: ${configFile}`)
    if (config.targets === undefined) continue
    if (!Array.isArray(config.targets)) {
      throw new Error(`Config "targets" must be a sequence: ${configFile}`)
    }

    for (const [targetIndex, target] of config.targets.entries()) {
      const label = `${configFile} target #${targetIndex + 1}`
      if (!isRecord(target)) throw new Error(`${label} must be a mapping`)
      if (!isRecord(target.provider))
        throw new Error(`${label} provider must be a mapping`)
      const providerName = target.provider.name
      if (typeof providerName !== 'string' || providerName.trim() === '') {
        throw new Error(`${label} provider.name must be a non-empty string`)
      }
      providers.add(providerName)
    }
  }

  return [...providers]
}
