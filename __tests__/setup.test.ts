import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeLauncher } from '../src/setup.js'

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
