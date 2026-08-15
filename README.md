# Setup Anvil

Set up an isolated [Anvil](https://github.com/JSChronicles/anvil) CLI in GitHub
Actions. When an Anvil command includes configuration files, this action
discovers their stock providers and ensures the corresponding optional Anvil
dependencies are installed before running the real CLI.

The workflow continues to use normal Anvil commands. There are no action inputs
for commands, arguments, config files, or providers.

## Usage

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v6

  - name: Set up Anvil
    uses: JSChronicles/setup-anvil@v1

  - name: Run Anvil
    run: anvil run --config-file anvil.yaml
```

Multiple configuration files retain their supplied order:

```yaml
- name: Set up Anvil
  uses: JSChronicles/setup-anvil@v1

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
- uses: JSChronicles/setup-anvil@v1
  with:
    anvil-version: '0.31.0'
```

Use `latest` only when intentionally opting into a version that can change
between otherwise identical workflow runs:

```yaml
- uses: JSChronicles/setup-anvil@v1
  with:
    anvil-version: latest
```

The selected version is available as the `anvil-version` action output.

uv normally selects and, when needed, downloads a compatible managed Python. An
optional override is available for older Anvil releases or unusual runners:

```yaml
- uses: JSChronicles/setup-anvil@v1
  with:
    anvil-version: '0.31.0'
    python-version: '3.14'
```

## How provider setup works

The action installs Anvil into a private uv-managed environment. It places a
small `anvil` shim first on `PATH` while keeping the real executable at a known
private path.

For an invocation containing `--config-file`, the shim:

1. captures the original argument vector;
2. extracts config paths without changing or deduplicating them;
3. safely reads only `targets[*].provider.name` from each YAML file;
4. deduplicates provider names for dependency installation;
5. derives available stock providers and extras from the installed Anvil
   distribution;
6. asks uv to ensure all required extras in one operation; and
7. invokes the real Anvil executable with the untouched original arguments.

uv compares the combined requirement with the actual environment, so repeated
commands do not require a separate provider-state file. Concurrent installation
attempts are serialized with a private runtime lock.

The shim does not implement config globbing, automatic discovery, Anvil command
semantics, provider options, tasks, processors, validation, or execution. Anvil
remains authoritative for those behaviors.

## Supported providers

Automatic installation applies to stock providers shipped by the selected Anvil
distribution. A stock provider with a same-named optional extra causes that
extra to be installed. Providers included in the base Anvil installation, such
as AWS in Anvil 0.31.0, require no additional operation.

Third-party provider plugin names cannot securely identify which external
package should be installed. Such plugins are not automatically installed in
version 1.

## Platforms

Version 1 supports GitHub-hosted and compatible self-hosted Linux and macOS
runners. Windows is not currently supported because a `.cmd` launcher can
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
- The real Anvil executable is invoked by absolute path, preventing shim
  recursion.
- The action itself needs no GitHub token. Start with `contents: read` and add
  only permissions required by provider authentication, such as
  `id-token: write` for OIDC.

For hardened workflows, pin this action and all other actions to full commit
SHAs instead of floating major tags.

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
