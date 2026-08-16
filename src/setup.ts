import * as core from '@actions/core'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readAnvilMetadata } from './metadata.js'
import { inheritProcess } from './process.js'

const EXACT_VERSION =
  /^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?$/
const PYTHON_VERSION = /^(?:cpython@)?\d+(?:\.\d+){0,2}$/

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

async function findToolEnvironment(toolDirectory: string): Promise<string> {
  const entries = await readdir(toolDirectory, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(toolDirectory, entry.name)
    try {
      const config = await stat(join(candidate, 'pyvenv.cfg'))
      if (config.isFile()) return candidate
    } catch {
      // This directory is not a Python environment.
    }
  }
  throw new Error('uv did not create an identifiable Anvil tool environment')
}

async function findExecutable(name: string): Promise<string> {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`${name} is unavailable after setup`)
}

export async function discoverProjectDirectory(
  workspace = process.env.GITHUB_WORKSPACE,
  cwd = process.cwd()
): Promise<string | undefined> {
  const candidates = workspace ? [workspace, cwd] : [cwd]
  for (const candidate of new Set(candidates.map((item) => resolve(item)))) {
    try {
      const pyproject = await stat(join(candidate, 'pyproject.toml'))
      if (pyproject.isFile()) return await realpath(candidate)
    } catch {
      // Continue to the safe current-working-directory fallback.
    }
  }
  return undefined
}

export function buildInstallArgs(
  requirement: string,
  pythonVersion: string,
  projectDirectory?: string
): string[] {
  const args = ['tool', 'install', '--managed-python', '--no-config']
  if (pythonVersion) args.push('--python', pythonVersion)
  if (projectDirectory) args.push('--with', projectDirectory)
  args.push(requirement)
  return args
}

export async function writeLauncher(
  launcher: string,
  contents: string
): Promise<void> {
  await mkdir(dirname(launcher), { recursive: true })
  await writeFile(launcher, contents, { encoding: 'utf8', mode: 0o755 })
  await chmod(launcher, 0o755)
}

export async function run(): Promise<void> {
  try {
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
      throw new Error('setup-anvil currently supports Linux and macOS runners')
    }

    const requestedVersion = core
      .getInput('anvil-version', { required: true })
      .trim()
    const pythonVersion = core.getInput('python-version').trim()
    if (
      requestedVersion !== 'latest' &&
      !EXACT_VERSION.test(requestedVersion)
    ) {
      throw new Error(
        'anvil-version must be an exact version such as 0.31.0, or "latest"'
      )
    }
    if (pythonVersion && !PYTHON_VERSION.test(pythonVersion)) {
      throw new Error('python-version must be a version such as 3.14 or 3.14.1')
    }

    const runnerTemp = process.env.RUNNER_TEMP || tmpdir()
    const runtimeDirectory = await mkdtemp(
      join(resolve(runnerTemp), 'setup-anvil-')
    )
    const toolDirectory = join(runtimeDirectory, 'tools')
    const realBinDirectory = join(runtimeDirectory, 'real-bin')
    const shimDirectory = join(runtimeDirectory, 'shim')
    const uv = await findExecutable('uv')
    const requirement =
      requestedVersion === 'latest' ? 'anvil' : `anvil==${requestedVersion}`
    const uvEnvironment = {
      ...process.env,
      UV_TOOL_BIN_DIR: realBinDirectory,
      UV_TOOL_DIR: toolDirectory
    }
    const projectDirectory = await discoverProjectDirectory()
    const installArgs = buildInstallArgs(
      requirement,
      pythonVersion,
      projectDirectory
    )

    core.info(
      projectDirectory
        ? `Installing ${requirement} and the checked-out Python project in an isolated environment`
        : `Installing ${requirement} in an isolated environment`
    )
    const installExitCode = await inheritProcess(uv, installArgs, uvEnvironment)
    if (installExitCode !== 0) {
      throw new Error(
        `uv failed to install ${requirement} (exit code ${installExitCode})`
      )
    }

    const environmentDirectory = await findToolEnvironment(toolDirectory)
    const python = join(environmentDirectory, 'bin', 'python')
    const realAnvil = join(realBinDirectory, 'anvil')
    await access(python, constants.X_OK)
    await access(realAnvil, constants.X_OK)
    const metadata = await readAnvilMetadata(python, projectDirectory)
    if (projectDirectory && !metadata.project) {
      throw new Error(
        'The checked-out Python project was not found in the Anvil environment after installation'
      )
    }

    const setupBundleDirectory = dirname(fileURLToPath(import.meta.url))
    const shimBundle = resolve(setupBundleDirectory, '..', 'shim', 'index.js')
    await access(shimBundle, constants.R_OK)
    const launcher = join(shimDirectory, 'anvil')
    const launcherContents = [
      '#!/usr/bin/env sh',
      `export SETUP_ANVIL_ENVIRONMENT=${shellQuote(environmentDirectory)}`,
      `export SETUP_ANVIL_PYTHON=${shellQuote(python)}`,
      `export SETUP_ANVIL_REAL=${shellQuote(realAnvil)}`,
      `export SETUP_ANVIL_SHIM_DIRECTORY=${shellQuote(shimDirectory)}`,
      `export SETUP_ANVIL_UV=${shellQuote(uv)}`,
      `export SETUP_ANVIL_VERSION=${shellQuote(metadata.version)}`,
      ...(projectDirectory
        ? [`export SETUP_ANVIL_PROJECT=${shellQuote(projectDirectory)}`]
        : []),
      `exec ${shellQuote(process.execPath)} ${shellQuote(shimBundle)} "$@"`,
      ''
    ].join('\n')
    await writeLauncher(launcher, launcherContents)

    core.addPath(shimDirectory)
    core.setOutput('anvil-version', metadata.version)
    core.info(`Installed Anvil ${metadata.version}`)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
