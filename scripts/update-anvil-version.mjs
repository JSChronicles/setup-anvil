import { readFile, writeFile } from 'node:fs/promises'

const [version] = process.argv.slice(2)
const exactVersion = /^\d+\.\d+\.\d+$/

if (!version || !exactVersion.test(version)) {
  throw new Error('usage: node scripts/update-anvil-version.mjs <x.y.z>')
}

const compatibilityPath = '.github/anvil-compatibility.json'
const compatibility = JSON.parse(await readFile(compatibilityPath, 'utf8'))
const previousVersion = compatibility.anvil_version

if (!exactVersion.test(previousVersion || '')) {
  throw new Error(
    `${compatibilityPath} does not contain a stable Anvil version`
  )
}

compatibility.anvil_version = version
await writeFile(
  compatibilityPath,
  `${JSON.stringify(compatibility, null, 2)}\n`,
  'utf8'
)

const readmePath = 'README.md'
const readme = await readFile(readmePath, 'utf8')
if (!readme.includes(previousVersion)) {
  throw new Error(`${readmePath} does not contain Anvil ${previousVersion}`)
}
await writeFile(readmePath, readme.replaceAll(previousVersion, version))

console.log(
  `Updated the tested Anvil version from ${previousVersion} to ${version}`
)
