import { jest } from '@jest/globals'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const readAnvilMetadata = jest.fn<
  () => Promise<{
    extras: string[]
    providers: string[]
    version: string
  }>
>()
const inheritProcess = jest.fn<() => Promise<number>>()

jest.unstable_mockModule('../src/metadata.js', () => ({ readAnvilMetadata }))
jest.unstable_mockModule('../src/process.js', () => ({ inheritProcess }))

const { runShim } = await import('../src/shim.js')

describe('runShim', () => {
  let directory: string
  let originalEnvironment: NodeJS.ProcessEnv

  beforeEach(async () => {
    jest.resetAllMocks()
    directory = await mkdtemp(join(tmpdir(), 'setup-anvil-shim-'))
    const realAnvil = join(directory, 'real-anvil')
    await writeFile(realAnvil, '')
    await chmod(realAnvil, 0o755)
    originalEnvironment = { ...process.env }
    Object.assign(process.env, {
      SETUP_ANVIL_ENVIRONMENT: directory,
      SETUP_ANVIL_PYTHON: join(directory, 'python'),
      SETUP_ANVIL_REAL: realAnvil,
      SETUP_ANVIL_SHIM_DIRECTORY: join(directory, 'shim'),
      SETUP_ANVIL_UV: 'uv',
      SETUP_ANVIL_VERSION: '0.31.0'
    })
    await mkdir(process.env.SETUP_ANVIL_SHIM_DIRECTORY!, { recursive: true })
    readAnvilMetadata.mockResolvedValue({
      extras: ['azure', 'gcp', 'github'],
      providers: ['aws', 'azure', 'gcp', 'github'],
      version: '0.31.0'
    })
    inheritProcess.mockResolvedValue(0)
  })

  afterEach(() => {
    process.env = originalEnvironment
  })

  it('passes commands without configs directly to the real Anvil', async () => {
    const args = ['list', '--tasks']

    await expect(runShim(args)).resolves.toBe(0)
    expect(readAnvilMetadata).not.toHaveBeenCalled()
    expect(inheritProcess).toHaveBeenCalledTimes(1)
    expect(inheritProcess).toHaveBeenCalledWith(
      process.env.SETUP_ANVIL_REAL,
      args
    )
  })

  it('installs combined extras and forwards the exact original argv', async () => {
    await writeFile(
      join(directory, 'C.yaml'),
      'targets:\n  - provider:\n      name: azure\n  - provider:\n      name: aws\n'
    )
    await writeFile(
      join(directory, 'A.yaml'),
      'targets:\n  - provider:\n      name: gcp\n'
    )
    const args = [
      'run',
      '--config-file',
      'C.yaml',
      'A.yaml',
      '--include',
      'x; echo unsafe'
    ]
    const cwd = process.cwd()
    process.chdir(directory)
    try {
      await expect(runShim(args)).resolves.toBe(0)
    } finally {
      process.chdir(cwd)
    }

    expect(inheritProcess).toHaveBeenNthCalledWith(1, 'uv', [
      'pip',
      'install',
      '--python',
      directory,
      '--no-config',
      'anvil[azure,gcp]==0.31.0'
    ])
    expect(inheritProcess).toHaveBeenNthCalledWith(
      2,
      process.env.SETUP_ANVIL_REAL,
      args
    )
    expect(args).toEqual([
      'run',
      '--config-file',
      'C.yaml',
      'A.yaml',
      '--include',
      'x; echo unsafe'
    ])
  })

  it('does not invoke uv for a base provider', async () => {
    await writeFile(
      join(directory, 'aws.yaml'),
      'targets:\n  - provider:\n      name: aws\n'
    )
    const cwd = process.cwd()
    process.chdir(directory)
    try {
      await expect(
        runShim(['validate', '--config-file', 'aws.yaml'])
      ).resolves.toBe(0)
    } finally {
      process.chdir(cwd)
    }

    expect(inheritProcess).toHaveBeenCalledTimes(1)
    expect(inheritProcess).toHaveBeenCalledWith(process.env.SETUP_ANVIL_REAL, [
      'validate',
      '--config-file',
      'aws.yaml'
    ])
  })

  it('rejects an unsupported provider before executing Anvil', async () => {
    await writeFile(
      join(directory, 'unknown.yaml'),
      'targets:\n  - provider:\n      name: unknown\n'
    )
    const cwd = process.cwd()
    process.chdir(directory)
    try {
      await expect(
        runShim(['run', '--config-file', 'unknown.yaml'])
      ).rejects.toThrow('Provider "unknown" is not available in Anvil 0.31.0')
    } finally {
      process.chdir(cwd)
    }
    expect(inheritProcess).not.toHaveBeenCalled()
  })

  it('propagates the real Anvil exit code', async () => {
    inheritProcess.mockResolvedValueOnce(23)
    await expect(runShim(['list', '--processors'])).resolves.toBe(23)
  })

  it('rejects a real executable that resolves inside the shim directory', async () => {
    const recursiveAnvil = join(
      process.env.SETUP_ANVIL_SHIM_DIRECTORY!,
      'anvil'
    )
    await writeFile(recursiveAnvil, '')
    await chmod(recursiveAnvil, 0o755)
    process.env.SETUP_ANVIL_REAL = recursiveAnvil

    await expect(runShim(['list', '--tasks'])).rejects.toThrow(
      'Real Anvil executable resolves inside the shim directory'
    )
    expect(inheritProcess).not.toHaveBeenCalled()
  })
})
