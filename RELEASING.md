# Releasing Setup Anvil

Releases are prepared by Release Drafter and published by the manual Release
workflow. The exact semantic tag is attached to an immutable GitHub Release; the
separate `v0` compatibility tag remains movable.

## Pull request labels

Release Drafter groups changes with these labels:

- `breaking-change`
- `feature` or `enhancement`
- `bug` or `bugfix`
- `documentation`
- `dependencies`
- `maintenance` or `ci`

Version resolution uses `major`, `minor`, and `patch`. A `breaking-change`,
`feature`, or `enhancement` label selects a minor release during pre-1.0; `bug`
and `bugfix` select a patch release. Use `major` only when intentionally
promoting to `v1.0.0` or later. Unlabelled changes default to a patch release,
and `skip-changelog` omits a pull request from the notes. With no previous
release, Release Drafter starts at `v0.1.0`.

## Required repository settings

1. In **Settings > Environments**, create an environment named `release`.
2. Add the maintainers or maintainer team as required reviewers. Enable
   **Prevent self-review** when a second maintainer is always available.
3. Restrict deployment branches to `main` (selected branches and tags) or to
   protected branches if `main` is protected. The Release workflow must be
   dispatched from the current `main` commit.
4. In **Settings > Actions > General > Workflow permissions**, select **Read
   repository contents and packages permissions**. The workflows grant
   `contents: write` only to the Release Drafter and publication jobs.
5. In **Settings > General > Releases**, enable release immutability before the
   first release. It applies only to releases published after it is enabled.

No environment secrets or long-lived personal access token are required.

## Optional hardening

- Add an active tag ruleset for exact semantic tags such as
  `v[0-9]*.[0-9]*.[0-9]*` that blocks updates and deletions. If the ruleset also
  restricts tag creation, give the GitHub Actions app bypass permission so the
  approved Release workflow can create the exact tag. Test the ruleset in
  evaluate mode first.
- Do not include `v0` in an update-blocking exact-tag ruleset. If a separate
  ruleset protects `v0`, it must allow the GitHub Actions app to update that
  tag.
- Protect `main` with required pull requests and the existing CI, bundled
  JavaScript, and CodeQL checks.

## Publish a release

1. Merge the intended release commit, including matching versions in
   `package.json` and `package-lock.json` and synchronized `dist/`, to `main`.
2. Confirm the Release Drafter run produced the expected draft (initially
   `v0.1.0`) and that its target is the current `main` commit. Edit the draft
   notes if needed, but do not publish it manually.
3. Open **Actions > Release > Run workflow**, select `main`, and enter `0.1.0`
   without a `v` prefix.
4. Let metadata validation, CI, bundle verification, and the Linux/macOS action
   smoke tests finish.
5. Review and approve the `release` environment deployment.
6. Confirm the workflow published `v0.1.0` and created or moved `v0` to the same
   commit. If only the final tag update fails, rerun the failed job; the publish
   step is also safe to resume when the exact release is already correct.

Never move an exact semantic release tag. Future compatible pre-1.0 releases
move only `v0`.

## GitHub Marketplace (optional)

After `v0.1.0` is published, open that release, choose **Publish this Action to
the GitHub Marketplace**, select categories, and complete publication. The
repository must be public, the root `action.yml` name must be unique, and an
organization owner may need to accept the GitHub Marketplace Developer
Agreement. Marketplace publication is a separate manual action and is not
performed by the release workflow.
