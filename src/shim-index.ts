import { runShim } from './shim.js'

try {
  process.exitCode = await runShim(process.argv.slice(2))
} catch (error) {
  console.error(
    `setup-anvil: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
}
