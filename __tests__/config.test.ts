import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverProviders, extractConfigFiles } from '../src/config.js'

describe('extractConfigFiles', () => {
  it('preserves nargs config ordering', () => {
    const args = [
      'run',
      '--config-file',
      'C.yaml',
      'A.yaml',
      'B.yaml',
      '--include',
      'production'
    ]

    expect(extractConfigFiles(args)).toEqual(['C.yaml', 'A.yaml', 'B.yaml'])
    expect(args).toEqual([
      'run',
      '--config-file',
      'C.yaml',
      'A.yaml',
      'B.yaml',
      '--include',
      'production'
    ])
  })

  it('supports repeated and equals forms without globbing', () => {
    expect(
      extractConfigFiles([
        'validate',
        '--config-file',
        'configs/*.yaml',
        '--config-file=A file.yaml',
        '--config-file',
        'B;echo injected.yaml'
      ])
    ).toEqual(['configs/*.yaml', 'A file.yaml', 'B;echo injected.yaml'])
  })

  it('ignores option-looking values after the option terminator', () => {
    expect(
      extractConfigFiles(['list', '--', '--config-file', 'ignored.yaml'])
    ).toEqual([])
  })

  it('rejects a missing path', () => {
    expect(() =>
      extractConfigFiles(['run', '--config-file', '--include', 'x'])
    ).toThrow('--config-file requires at least one path')
    expect(() => extractConfigFiles(['run', '--config-file='])).toThrow(
      '--config-file requires a path'
    )
  })
})

describe('discoverProviders', () => {
  it('combines providers in first-seen order without deduplicating config files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'setup-anvil-config-'))
    await writeFile(
      join(directory, 'C.yaml'),
      'targets:\n  - provider:\n      name: aws\n  - provider:\n      name: cloudflare\n'
    )
    await writeFile(
      join(directory, 'A.yaml'),
      'targets:\n  - provider:\n      name: aws\n  - provider:\n      name: datadog\n'
    )

    await expect(
      discoverProviders(['C.yaml', 'A.yaml', 'C.yaml'], directory)
    ).resolves.toEqual(['aws', 'cloudflare', 'datadog'])
  })

  it('reports malformed YAML with the relevant file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'setup-anvil-config-'))
    await writeFile(join(directory, 'broken.yaml'), 'targets: [\n')

    await expect(discoverProviders(['broken.yaml'], directory)).rejects.toThrow(
      /Malformed YAML in broken\.yaml/
    )
  })

  it('reports malformed provider structures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'setup-anvil-config-'))
    await writeFile(
      join(directory, 'missing.yaml'),
      'targets:\n  - provider: {}\n'
    )

    await expect(
      discoverProviders(['missing.yaml'], directory)
    ).rejects.toThrow(
      'missing.yaml target #1 provider.name must be a non-empty string'
    )
  })

  it('reports missing files without hiding the supplied path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'setup-anvil-config-'))
    await expect(
      discoverProviders(['not here.yaml'], directory)
    ).rejects.toThrow('Config file not found or unreadable: not here.yaml')
  })
})
