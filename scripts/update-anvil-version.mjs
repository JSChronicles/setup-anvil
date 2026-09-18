import { readFile, writeFile } from 'node:fs/promises'

const [version] = process.argv.slice(2)
const exactVersion = /^\d+\.\d+\.\d+$/

if (!version || !exactVersion.test(version)) {
  throw new Error('usage: node scripts/update-anvil-version.mjs <x.y.z>')
}

const actionPath = 'action.yml'
const action = await readFile(actionPath, 'utf8')
const defaultPattern = /(    default: ')(\d+\.\d+\.\d+)(')/
const match = action.match(defaultPattern)

if (!match) {
  throw new Error('could not find the default Anvil version in action.yml')
}

const previousVersion = match[2]
const updatedAction = action.replace(defaultPattern, `$1${version}$3`)
await writeFile(actionPath, updatedAction)

for (const path of ['README.md', '.github/workflows/ci.yml']) {
  const contents = await readFile(path, 'utf8')
  if (!contents.includes(previousVersion)) {
    throw new Error(`${path} does not contain Anvil ${previousVersion}`)
  }
  await writeFile(path, contents.replaceAll(previousVersion, version))
}

console.log(
  `Updated the default Anvil version from ${previousVersion} to ${version}`
)
