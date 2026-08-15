import { captureProcess, inheritProcess } from '../src/process.js'

describe('process execution', () => {
  it('passes hostile-looking values as literal arguments without a shell', async () => {
    const values = [
      'space value',
      'quote"value',
      'semi;echo injected',
      '$(echo injected)'
    ]
    const result = await captureProcess(process.execPath, [
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      ...values
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual(values)
  })

  it('returns the child process exit code', async () => {
    await expect(
      inheritProcess(process.execPath, ['-e', 'process.exit(23)'])
    ).resolves.toBe(23)
  })
})
