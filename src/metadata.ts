import { captureProcess } from './process.js'

export interface AnvilMetadata {
  extras: string[]
  providers: string[]
  version: string
}

const METADATA_SCRIPT = String.raw`
import importlib.metadata
import json

distribution = importlib.metadata.distribution("anvil")
extras = sorted(set(distribution.metadata.get_all("Provides-Extra") or []))
providers = set()
for item in distribution.files or []:
    parts = tuple(item.parts)
    if len(parts) >= 4 and parts[:2] == ("anvil", "providers"):
        provider = parts[2]
        if provider not in {"base", "tasks", "__pycache__"}:
            providers.add(provider)
print(json.dumps({
    "version": distribution.version,
    "extras": extras,
    "providers": sorted(providers),
}))
`.trim()

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid Anvil metadata field: ${field}`)
  }
  return value as string[]
}

export async function readAnvilMetadata(
  python: string
): Promise<AnvilMetadata> {
  const result = await captureProcess(python, ['-I', '-c', METADATA_SCRIPT])
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to inspect the installed Anvil package: ${result.stderr.trim()}`
    )
  }

  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error('Installed Anvil returned invalid package metadata', {
      cause: error
    })
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Installed Anvil returned invalid package metadata')
  }
  const metadata = value as Record<string, unknown>
  if (typeof metadata.version !== 'string' || metadata.version === '') {
    throw new Error('Installed Anvil metadata does not include a version')
  }
  return {
    extras: stringArray(metadata.extras, 'extras'),
    providers: stringArray(metadata.providers, 'providers'),
    version: metadata.version
  }
}
