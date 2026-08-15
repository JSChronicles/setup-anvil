import { constants } from 'node:fs'
import { access, open, realpath, stat, unlink } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { discoverProviders, extractConfigFiles } from './config.js'
import { readAnvilMetadata } from './metadata.js'
import { inheritProcess } from './process.js'

const LOCK_TIMEOUT_MS = 30_000
const STALE_LOCK_MS = 5 * 60_000

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
    const metadata = await readAnvilMetadata(python)
    if (metadata.version !== expectedVersion) {
      throw new Error(
        `Installed Anvil version changed unexpectedly: expected ${expectedVersion}, found ${metadata.version}`
      )
    }

    const knownProviders = new Set(metadata.providers)
    const availableExtras = new Set(metadata.extras)
    const requiredExtras: string[] = []
    for (const provider of requestedProviders) {
      if (!knownProviders.has(provider)) {
        throw new Error(
          `Provider "${provider}" is not available in Anvil ${metadata.version}`
        )
      }
      if (availableExtras.has(provider)) requiredExtras.push(provider)
    }

    if (requiredExtras.length > 0) {
      const requirement = `anvil[${requiredExtras.join(',')}]==${metadata.version}`
      await withInstallLock(environment, async () => {
        const exitCode = await inheritProcess(uv, [
          'pip',
          'install',
          '--python',
          environment,
          '--no-config',
          requirement
        ])
        if (exitCode !== 0) {
          throw new Error(
            `uv failed to install provider dependencies for ${requiredExtras.join(', ')}`
          )
        }
      })
    }
  }

  return await inheritProcess(resolvedRealAnvil, originalArgs)
}
