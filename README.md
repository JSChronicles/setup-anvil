# Setup Anvil

Set up an isolated [Anvil](https://github.com/JSChronicles/anvil) CLI in GitHub
Actions. The checked-out Python project is installed alongside Anvil, so its
plugin providers, plugin tasks, and plugin processors work through Anvil's
normal entry-point discovery. When an Anvil command includes configuration
files, this action installs only the advertised optional dependencies matching
the selected providers before running the real CLI.

The workflow continues to use normal Anvil commands. There are no action inputs
for commands, arguments, config files, or providers.

## Usage

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

  - name: Set up Anvil
    uses: JSChronicles/setup-anvil@v0

  - name: Run Anvil
    run: anvil run --config-file anvil.yaml
```

Multiple configuration files retain their supplied order:

```yaml
- name: Set up Anvil
  uses: JSChronicles/setup-anvil@v0

- name: Run Anvil
  run: >
    anvil run --config-file anvil/01-foundation.yaml anvil/02-security.yaml
```

Other commands remain ordinary Anvil CLI invocations:

```yaml
- run: anvil validate --config-file anvil.yaml
- run: anvil list --tasks
- run: anvil list --processors
```

Commands without `--config-file` pass directly to Anvil without YAML inspection
or provider installation.

## Version selection

The default action release installs an exact, integration-tested Anvil version.
Choose another exact version with `anvil-version`:

```yaml
- uses: JSChronicles/setup-anvil@v0
  with:
    anvil-version: '0.31.0'
```

Use `latest` only when intentionally opting into a version that can change
between otherwise identical workflow runs:

```yaml
- uses: JSChronicles/setup-anvil@v0
  with:
    anvil-version: latest
```

The selected version is available as the `anvil-version` action output.

uv normally selects and, when needed, downloads a compatible managed Python. An
optional override is available for older Anvil releases or unusual runners:

```yaml
- uses: JSChronicles/setup-anvil@v0
  with:
    anvil-version: '0.31.0'
    python-version: '3.14'
```

## Python projects and plugins

When `pyproject.toml` exists in `GITHUB_WORKSPACE` (or the safe current-working-
directory fallback), the action installs that project by absolute filesystem
path into Anvil's private environment. The `[project].name` can be changed; the
action never hardcodes or uses it for a PyPI lookup.

The base project is installed during Anvil's initial uv resolution. Anvil then
discovers its standard entry points normally, including `anvil.providers.tasks`,
provider-specific `anvil.providers.<provider>.tasks`, `anvil.processors`, and
`anvil.provider_packages`. No task or processor catalog is required. Provider
package roots are discovered from metadata without eagerly importing or
constructing provider implementations.

Here is a complete minimal project that contributes plugin tasks, plugin
processors, and a Snowflake plugin provider supplied by an optional package:

```toml
[build-system]
requires = ["hatchling>=1.27"]
build-backend = "hatchling.build"

[project]
name = "acme-security-anvil"
version = "1.0.0"
requires-python = ">=3.12"
dependencies = [
  "anvil==0.31.0",
]

[project.optional-dependencies]
snowflake = [
  "company-anvil-snowflake==2.4.1",
]

[project.entry-points."anvil.providers.tasks"]
acme = "acme_security_anvil.tasks"

[project.entry-points."anvil.providers.snowflake.tasks"]
acme-snowflake = "acme_security_anvil.snowflake_tasks"

[project.entry-points."anvil.processors"]
acme = "acme_security_anvil.processors"

[project.entry-points."anvil.provider_packages"]
acme = "acme_security_anvil.providers"
```

With a configuration containing `targets[*].provider.name: snowflake`, the shim
activates the local `snowflake` extra using the checkout's absolute path. That
installs `company-anvil-snowflake==2.4.1`; the real Anvil process then discovers
its provider through `anvil.provider_packages`.

A complete workflow checks out the package before setup and invokes Anvil as
usual:

```yaml
name: Anvil
on:
  pull_request:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: JSChronicles/setup-anvil@v0
        with:
          anvil-version: '0.31.0'
      - run: anvil validate --config-file anvil.yaml
      - run: anvil run --config-file anvil.yaml
```

If no `pyproject.toml` is found, setup retains its stock-components-only
behavior.

## How provider setup works

The action installs Anvil into a private uv-managed environment. It places a
small `anvil` shim first on `PATH` while keeping the real executable at a known
private path.

For an invocation containing `--config-file`, the shim:

1. captures the original argument vector;
2. extracts config paths without changing or deduplicating them;
3. safely reads only `targets[*].provider.name` from each YAML file;
4. deduplicates provider names for dependency installation;
5. reads advertised extras from Anvil, the checked-out project distribution, and
   applicable installed plugin distributions/packages;
6. asks uv to ensure all matching extras in one serialized operation while
   preserving Anvil's exact selected version; and
7. invokes the real Anvil executable with the untouched original arguments.

uv compares the combined requirement with the actual environment, so repeated
commands do not require a separate provider-state file. Concurrent installation
attempts are serialized with a private runtime lock.

The shim does not implement config globbing, Anvil command semantics, provider
options, task or processor declarations, validation, or execution. It also does
not parse YAML to select plugin tasks or plugin processors. Anvil remains
authoritative for discovery and validation.

## Provider dependency selection

For stock components, a stock provider with a same-named Anvil extra activates
that extra, such as `anvil[gcp]`. Providers included in base Anvil, such as AWS
in Anvil 0.31.0, require no additional operation.

For plugin providers, a provider name activates an extra only when the same
normalized extra name is explicitly advertised by the checked-out project or an
applicable installed plugin distribution/package. For example, `snowflake`
activates the local path equivalent of `.[snowflake]`. Extras use Python
packaging normalization, so hyphens, underscores, and dots compare consistently.
Multiple and duplicate providers are resolved once in a single installation
operation.

Third-party distribution names are never guessed from provider names. If no
advertised extra matches, the shim performs no speculative installation and
delegates provider validation to Anvil, which produces the authoritative error
if the plugin provider is still unavailable.

## Platforms

The pre-1.0 releases support GitHub-hosted and compatible self-hosted Linux and
macOS runners. Windows is not currently supported because a `.cmd` launcher can
re-enter command parsing and weaken the exact argument and shell-injection
guarantees.

The composite action uses GitHub's `$/dist/setup` self-reference. This feature
is available on GitHub.com but not on GitHub Enterprise Server.

## Security

- CLI arguments are passed as an array with `shell: false`.
- Config paths and unrelated arguments are never reconstructed into a command
  string.
- YAML custom object construction is not enabled, aliases are limited during
  conversion, and config files have a 5 MiB inspection limit.
- Consumer uv project configuration is ignored for the private environment.
- Arbitrary provider names are never converted into external package names.
- Local extras are interpolated only after confirmation from installed project
  metadata, and use the checkout's absolute path.
- Plugin distributions/packages and entry points are inspected as metadata;
  plugin implementations are not imported or executed during setup discovery.
- The real Anvil executable is invoked by absolute path, preventing shim
  recursion.
- The action itself needs no GitHub token. Start with `contents: read` and add
  only permissions required by provider authentication, such as
  `id-token: write` for OIDC.

For hardened workflows, pin this action and all other actions to full commit
SHAs instead of floating major tags.

## Release versioning

Setup Anvil is currently pre-1.0. Every change pushed to `main` is tested and
the committed bundles are verified before semantic-release decides whether to
publish a release. Conventional `feat` commits and breaking changes increment
the minor version; `fix`, `perf`, `revert`, and dependency commits increment the
patch version. Other commit types do not publish a release.

Use `JSChronicles/setup-anvil@v0` for convenient updates that remain compatible
within the pre-1.0 release line. The release workflow automatically moves this
major-version tag after publishing each stable release.

For a fixed semantic release, use `JSChronicles/setup-anvil@v0.1.0`. For the
strongest supply-chain guarantee, pin the full commit SHA for that release:

```yaml
- uses: JSChronicles/setup-anvil@<full-release-commit-sha> # v0.1.0
```

Backwards-compatible fixes and features can update `v0`. Potentially breaking
changes may be released as a new `0.x.0` version. Once the public interface and
behavior are stable, the project will promote to `v1.0.0` and add a floating
`v1` tag.

## Development

This repository requires Node.js 24 and npm.

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Both bundled entry points under `dist/` are committed. CI rebuilds them and
fails if generated output differs from source.

## License

MIT
