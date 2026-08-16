import { jest } from '@jest/globals'

const captureProcess =
  jest.fn<
    (
      executable: string,
      args: readonly string[]
    ) => Promise<{ exitCode: number; stderr: string; stdout: string }>
  >()

jest.unstable_mockModule('../src/process.js', () => ({ captureProcess }))

const { readAnvilMetadata } = await import('../src/metadata.js')

describe('readAnvilMetadata', () => {
  it('finds a renamed local distribution and registered plugin metadata without imports', async () => {
    captureProcess.mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        extras: ['gcp'],
        pluginDistributions: [
          {
            extras: ['snowflake'],
            name: 'company-anvil-snowflake',
            providers: ['snowflake'],
            version: '2.4.1'
          }
        ],
        project: {
          extras: ['snowflake'],
          name: 'renamed-consumer-project'
        },
        version: '0.31.0'
      })
    })

    await expect(
      readAnvilMetadata('/environment/python', '/absolute/checkout')
    ).resolves.toEqual({
      extras: ['gcp'],
      pluginDistributions: [
        {
          extras: ['snowflake'],
          name: 'company-anvil-snowflake',
          providers: ['snowflake'],
          version: '2.4.1'
        }
      ],
      project: {
        extras: ['snowflake'],
        name: 'renamed-consumer-project'
      },
      version: '0.31.0'
    })
    expect(captureProcess).toHaveBeenCalledWith(
      '/environment/python',
      expect.arrayContaining([
        '-I',
        '-c',
        expect.any(String),
        '/absolute/checkout'
      ])
    )
    const script = captureProcess.mock.calls[0][1][2]
    expect(script).toContain('importlib.metadata.distributions()')
    expect(script).not.toContain('entry_point.load')
  })
})
