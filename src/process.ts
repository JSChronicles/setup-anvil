import { spawn } from 'node:child_process'

export interface ProcessResult {
  exitCode: number
  stderr: string
  stdout: string
}

export async function captureProcess(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.once('error', reject)
    child.once('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stderr, stdout })
    })
  })
}

export async function inheritProcess(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true
    })

    const forwardSignal = (signal: NodeJS.Signals): void => {
      if (!child.killed) child.kill(signal)
    }
    const onSigint = (): void => forwardSignal('SIGINT')
    const onSigterm = (): void => forwardSignal('SIGTERM')
    const removeSignalHandlers = (): void => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }

    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)
    child.once('error', (error) => {
      removeSignalHandlers()
      reject(error)
    })
    child.once('close', (exitCode, signal) => {
      removeSignalHandlers()
      if (exitCode !== null) {
        resolve(exitCode)
        return
      }
      resolve(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
    })
  })
}
