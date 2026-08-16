import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildInstallArgs,
  discoverProjectDirectory,
  writeLauncher
} from '../src/setup.js'

describe('project discovery and installation', () => {
  it('uses GITHUB_WORKSPACE when it contains a Python project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'setup-anvil-project-'))
    await writeFile(
      join(directory, 'pyproject.toml'),
      '[project]\nname = "anything"\n'
    )

    await expect(
      discoverProjectDirectory(directory, process.cwd())
    ).resolves.toBe(resolve(directory))
  })

  it('falls back safely to cwd and retains stock-only behavior without a project', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'setup-anvil-workspace-'))
    const cwd = await mkdtemp(join(tmpdir(), 'setup-anvil-cwd-'))
    await writeFile(
      join(cwd, 'pyproject.toml'),
      '[project]\nname = "renamed-project"\n'
    )

    await expect(discoverProjectDirectory(workspace, cwd)).resolves.toBe(
      resolve(cwd)
    )
    await mkdir(join(workspace, 'empty'))
    await expect(
      discoverProjectDirectory(join(workspace, 'empty'), workspace)
    ).resolves.toBeUndefined()
  })

  it('adds the absolute project path to the initial isolated resolution', () => {
    const project = resolve('a renamed project')

    expect(buildInstallArgs('anvil==0.31.0', '3.14', project)).toEqual([
      'tool',
      'install',
      '--managed-python',
      '--no-config',
      '--python',
      '3.14',
      '--with',
      project,
      'anvil==0.31.0'
    ])
    expect(buildInstallArgs('anvil==0.31.0', '')).toEqual([
      'tool',
      'install',
      '--managed-python',
      '--no-config',
      'anvil==0.31.0'
    ])
  })
})

describe('writeLauncher', () => {
  it('creates the shim directory before writing the launcher', async () => {
    const runtime = await mkdtemp(join(tmpdir(), 'setup-anvil-launcher-'))
    const launcher = join(runtime, 'shim', 'anvil')

    await writeLauncher(launcher, '#!/usr/bin/env sh\n')

    await expect(access(launcher)).resolves.toBeUndefined()
    await expect(readFile(launcher, 'utf8')).resolves.toBe(
      '#!/usr/bin/env sh\n'
    )
  })
})
