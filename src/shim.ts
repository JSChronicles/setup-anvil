import { constants } from 'node:fs'
import { access, open, realpath, stat, unlink } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { discoverProviders, extractConfigFiles } from './config.js'
import { readAnvilMetadata } from './metadata.js'
import { inheritProcess } from './process.js'

const LOCK_TIMEOUT_MS = 30_000
const STALE_LOCK_MS = 5 * 60_000

function normalizePackageName(value: string): string {
  return value.toLowerCase().replaceAll(/[-_.]+/g, '-')
}

function matchingExtra(
  extras: readonly string[],
  provider: string
): string | undefined {
  const normalizedProvider = normalizePackageName(provider)
  return extras.find(
    (extra) => normalizePackageName(extra) === normalizedProvider
  )
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`Required bootstrap value is unavailable: ${name}`)
  return value
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withInstallLock<T>(
  environment: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = `${environment}.provider-install.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS

  while (true) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        return await operation()
      } finally {
        await handle.close()
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      const lockStats = await stat(lockPath).catch(() => undefined)
      if (lockStats && Date.now() - lockStats.mtimeMs > STALE_LOCK_MS) {
        await unlink(lockPath).catch(() => undefined)
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error(
          'Timed out waiting for another Anvil dependency installation',
          { cause: error }
        )
      }
      await delay(100)
    }
  }
}

export async function runShim(
  originalArgs: readonly string[]
): Promise<number> {
  const realAnvil = requiredEnvironment('SETUP_ANVIL_REAL')
  const python = requiredEnvironment('SETUP_ANVIL_PYTHON')
  const environment = requiredEnvironment('SETUP_ANVIL_ENVIRONMENT')
  const uv = requiredEnvironment('SETUP_ANVIL_UV')
  const expectedVersion = requiredEnvironment('SETUP_ANVIL_VERSION')
  const shimDirectory = requiredEnvironment('SETUP_ANVIL_SHIM_DIRECTORY')
  try {
    await access(realAnvil, constants.X_OK)
  } catch (error) {
    throw new Error(`Real Anvil executable is unavailable: ${realAnvil}`, {
      cause: error
    })
  }
  const resolvedRealAnvil = await realpath(realAnvil)
  const relativeToShim = relative(
    await realpath(shimDirectory),
    resolvedRealAnvil
  )
  if (
    relativeToShim === '' ||
    (!relativeToShim.startsWith('..') && !isAbsolute(relativeToShim))
  ) {
    throw new Error('Real Anvil executable resolves inside the shim directory')
  }

  const configFiles = extractConfigFiles(originalArgs)
  if (configFiles.length > 0) {
    const requestedProviders = await discoverProviders(configFiles)
    const projectPath = process.env.SETUP_ANVIL_PROJECT
    const metadata = await readAnvilMetadata(python, projectPath)
    if (metadata.version !== expectedVersion) {
      throw new Error(
        `Installed Anvil version changed unexpectedly: expected ${expectedVersion}, found ${metadata.version}`
      )
    }

    if (projectPath && !metadata.project) {
      throw new Error(
        'The checked-out Python project is missing from the Anvil environment'
      )
    }

    const anvilExtras: string[] = []
    const projectExtras: string[] = []
    const pluginExtras = new Map<string, string[]>()
    for (const provider of requestedProviders) {
      const anvilExtra = matchingExtra(metadata.extras, provider)
      if (anvilExtra && !anvilExtras.includes(anvilExtra)) {
        anvilExtras.push(anvilExtra)
      }
      const projectExtra = metadata.project
        ? matchingExtra(metadata.project.extras, provider)
        : undefined
      if (projectExtra && !projectExtras.includes(projectExtra)) {
        projectExtras.push(projectExtra)
      }
      for (const plugin of metadata.pluginDistributions) {
        if (
          !plugin.providers.some(
            (name) =>
              normalizePackageName(name) === normalizePackageName(provider)
          )
        ) {
          continue
        }
        const pluginExtra = matchingExtra(plugin.extras, provider)
        if (!pluginExtra) continue
        const key = `${plugin.name}==${plugin.version}`
        const extras = pluginExtras.get(key) ?? []
        if (!extras.includes(pluginExtra)) extras.push(pluginExtra)
        pluginExtras.set(key, extras)
      }
    }

    const requirements: string[] = []
    if (projectPath && projectExtras.length > 0) {
      requirements.push(`${projectPath}[${projectExtras.join(',')}]`)
    }
    for (const [plugin, extras] of pluginExtras) {
      requirements.push(
        `${plugin.slice(0, plugin.lastIndexOf('=='))}[${extras.join(',')}]${plugin.slice(plugin.lastIndexOf('=='))}`
      )
    }

    if (requirements.length > 0) {
      requirements.unshift(
        anvilExtras.length > 0
          ? `anvil[${anvilExtras.join(',')}]==${metadata.version}`
          : `anvil==${metadata.version}`
      )
    } else if (anvilExtras.length > 0) {
      requirements.push(`anvil[${anvilExtras.join(',')}]==${metadata.version}`)
    }

    if (requirements.length > 0) {
      await withInstallLock(environment, async () => {
        const exitCode = await inheritProcess(uv, [
          'pip',
          'install',
          '--python',
          environment,
          '--no-config',
          ...requirements
        ])
        if (exitCode !== 0) {
          throw new Error(
            `uv failed to install provider dependencies for ${requestedProviders.join(', ')}`
          )
        }
      })
    }
  }

  return await inheritProcess(resolvedRealAnvil, originalArgs)
}
