import { captureProcess } from './process.js'

export interface AnvilMetadata {
  extras: string[]
  pluginDistributions: PluginDistributionMetadata[]
  project?: ProjectMetadata
  version: string
}

export interface ProjectMetadata {
  extras: string[]
  name: string
}

export interface PluginDistributionMetadata extends ProjectMetadata {
  providers: string[]
  version: string
}

const METADATA_SCRIPT = String.raw`
import importlib.metadata
import json
import os
import pathlib
import sys
import urllib.parse

distribution = importlib.metadata.distribution("anvil")
extras = sorted(set(distribution.metadata.get_all("Provides-Extra") or []))

project_path = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
project = None
plugins = []
for installed in importlib.metadata.distributions():
    name = installed.metadata.get("Name")
    if not name:
        continue
    installed_extras = sorted(set(installed.metadata.get_all("Provides-Extra") or []))

    is_project = False
    direct_url_text = installed.read_text("direct_url.json")
    if project_path is not None and direct_url_text:
        try:
            direct_url = json.loads(direct_url_text).get("url", "")
            parsed = urllib.parse.urlparse(direct_url)
            if parsed.scheme == "file":
                source_path = pathlib.Path(urllib.parse.unquote(parsed.path)).resolve()
                is_project = os.path.normcase(source_path) == os.path.normcase(project_path)
        except (json.JSONDecodeError, OSError, TypeError, ValueError):
            pass
    if is_project:
        project = {"name": name, "extras": installed_extras}

    providers = set()
    has_provider_packages = False
    for entry_point in installed.entry_points:
        group = entry_point.group
        if group == "anvil.provider_packages":
            has_provider_packages = True
            if entry_point.name:
                providers.add(entry_point.name)
        elif group.startswith("anvil.providers.") and group.endswith(".tasks"):
            provider = group[len("anvil.providers."):-len(".tasks")]
            if provider:
                providers.add(provider)
    if has_provider_packages:
        providers.update(installed_extras)
    if providers and not is_project and name.lower().replace("_", "-") != "anvil":
        plugins.append({
            "name": name,
            "version": installed.version,
            "extras": installed_extras,
            "providers": sorted(providers),
        })
print(json.dumps({
    "version": distribution.version,
    "extras": extras,
    "project": project,
    "pluginDistributions": plugins,
}))
`.trim()

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid Anvil metadata field: ${field}`)
  }
  return value as string[]
}

function projectMetadata(value: unknown, field: string): ProjectMetadata {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid Anvil metadata field: ${field}`)
  }
  const metadata = value as Record<string, unknown>
  if (typeof metadata.name !== 'string' || metadata.name === '') {
    throw new Error(`Invalid Anvil metadata field: ${field}.name`)
  }
  return {
    extras: stringArray(metadata.extras, `${field}.extras`),
    name: metadata.name
  }
}

export async function readAnvilMetadata(
  python: string,
  projectPath?: string
): Promise<AnvilMetadata> {
  const args = ['-I', '-c', METADATA_SCRIPT]
  if (projectPath) args.push(projectPath)
  const result = await captureProcess(python, args)
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
  const plugins = metadata.pluginDistributions
  if (!Array.isArray(plugins)) {
    throw new Error('Invalid Anvil metadata field: pluginDistributions')
  }
  const project =
    metadata.project === null || metadata.project === undefined
      ? undefined
      : projectMetadata(metadata.project, 'project')
  return {
    extras: stringArray(metadata.extras, 'extras'),
    pluginDistributions: plugins.map((plugin, index) => {
      const parsed = projectMetadata(plugin, `pluginDistributions[${index}]`)
      const value = plugin as Record<string, unknown>
      if (typeof value.version !== 'string' || value.version === '') {
        throw new Error(
          `Invalid Anvil metadata field: pluginDistributions[${index}].version`
        )
      }
      return {
        ...parsed,
        providers: stringArray(
          value.providers,
          `pluginDistributions[${index}].providers`
        ),
        version: value.version
      }
    }),
    project,
    version: metadata.version
  }
}
