# Development guide

## Repository layout

- `skills/<name>/` contains each independently installable skill: `SKILL.md`, `LICENSE`, `agents/openai.yaml`, and any future references or assets.
- Root `version.txt` and `CHANGELOG.md` track the version and release history of the entire repository.
- `scripts/`, `tests/`, and the private, versionless `package.json` contain development tooling outside distributable skills.
- `.github/workflows/`, `release-please-config.json`, and `.release-please-manifest.json` manage CI and releases.

The two templates, `template-skill-zh` and `template-skill-en`, provide developer guidance in Chinese and English respectively. Both require explicit invocation and only return the placeholder response defined in their `SKILL.md`. Neither performs business tool calls.

## Customize the template

On GitHub, use **Use this template → Create a new repository**, then clone the new repository. When maintaining a template repository yourself, enable **Settings → General → Template repository** to expose that button.

Update these files when adopting the template:

| Area | Files and changes |
|---|---|
| Repository identity | Replace `zmjlucas/skills-template`, checkout paths, and repository descriptions in `README.md`, `README.zh-cn.md`, and this guide. Keep the READMEs synchronized. |
| Development package | Change the name in `package.json` and both root name fields in `package-lock.json`. Keep the package private and versionless. |
| Skill identity | Rename the selected directory under `skills/`; match its `SKILL.md` frontmatter `name`; update its description, workflow, and `agents/openai.yaml` display text and exact `$skill-name` invocation. Remove unwanted examples. |
| Development deployment | All skill directories are discovered automatically. Update the playground directory and help text in `scripts/deploy-dev.mjs`; update the `owner` identifier in `scripts/lib/dev-build.mjs` from `skills-template/dev-deploy` to your repository identity. |
| Tests | Update template names, expected metadata, placeholder responses, and fixtures in `tests/`. Keep generic validation and deployment behavior tests. |
| Licensing | Review root and per-skill `LICENSE` files. Preserve notices required by retained code; add appropriate notices for new contributions. |
| Releases | Keep one root release package `.`. This template starts with `version.txt` at `0.0.0`, an empty release manifest, and no fabricated release entries. |

Changing the deployment owner makes previous builds with the old owner unmanaged. Use a new target or move the old installation yourself when redeploying; the tool refuses to overwrite an unrelated installation.

The placeholders show an explicit-invocation policy supported by the existing validator and development deployer. Retain `disable-model-invocation: true` and `policy.allow_implicit_invocation: false` while using this contract. If a future skill needs another policy, update the tooling, tests, and runtime acceptance together.

After renaming, search for the template names and repository identity, review intentional remaining references, and run the checks below. Keep development documentation, comments, diagnostics, and release notes in English; the Chinese template's business content may remain Chinese.

## Add a skill

1. Copy the appropriate language template to `skills/<new-name>/`.
2. Match its directory and frontmatter name, and update the description, workflow, UI metadata, and exact invocation token.
3. Keep its license and all distributable references or assets inside the skill directory. Keep development tooling outside it.
4. Add relevant behavior checks and actual invocation evidence for each supported host.
5. Keep release metadata at the repository root. New skills join the existing root release package `.`.

The validator requires a root version, root changelog, exactly one root release package, and plain `vX.Y.Z` tags. The manifest may be empty only while `version.txt` is `0.0.0`; subsequent versions require a matching `.` entry. Skill directories do not own release packages or version/changelog files.

Use Conventional Commits, for example:

```text
feat(example-skill): implement the business workflow
fix(dev-deploy): preserve explicit invocation metadata
docs: explain repository releases
```

Scopes describe the affected area; all releasable changes contribute to the same repository Release PR. A user-visible change in any skill affects the shared version. Documentation-only changes normally do not trigger a release under the default Release Please rules.

## Install dependencies and run checks

Use Node.js 24, as configured in `.node-version` and CI:

```bash
npm ci
npm run check
```

Individual commands:

```bash
npm run lint:skills
npm test
npm run test:install
```

`lint:skills` checks skill structure, release metadata, and invocation policy. `test` exercises validation and development deployment. `test:install` discovers every skill, invokes the pinned CLI in script-owned temporary directories, and verifies Codex and Claude Code separately. It compares the complete regular-file tree and file bytes with the source, including future references or assets. Installation verification does not prove that a host loads a skill or returns its expected response.

The development dependency pins `skills` to `1.5.25`. For a manual source installation, run this from a separate test workspace and use the checkout's actual absolute path:

```bash
SKILLS_SOURCE=/absolute/path/to/skills-template
npx --yes skills@1.5.25 add "$SKILLS_SOURCE" --skill template-skill-en --agent codex --copy --yes
```

Replace the skill with `template-skill-zh` to test the Chinese template, or the agent with `claude-code` to test Claude Code. Installed copies require reinstallation after source changes.

## Local development deployment

```bash
npm run dev:deploy
npm run dev:deploy -- --skill template-skill-en
```

The default deployment discovers every directory under `skills/` in name order and installs each development build under `<workspace>/.agents/skills/`, including `template-skill-zh-dev` and `template-skill-en-dev`. New skill directories are included automatically. Pass `--skill NAME` to deploy only one source. An empty skills directory is an error; non-directory files are ignored and symlink sources are rejected.

All selected skills share a separate `skills-template-playground` workspace under the operating system's temporary directory. A newly created workspace contains the installed development skills in `.agents/skills/`; later deployments preserve other workspace contents. Pass a new `--workspace` path when a test needs a fresh workspace. Unless a target is explicitly configured, the installation directory follows the final workspace after configuration and CLI overrides are applied. These development skills are local to that workspace and its subdirectories. Keep the workspace outside this repository so its `AGENTS.md` and development files do not become test context.

The command prints the installation path, build ID, test workspace, and invocation after each successful installation. Deployment stops on the first error; any earlier successful installations remain installed and are listed in the output. Select that workspace in the local Codex desktop application and start a new task, or enter the workspace in a terminal and run `codex`. For example, invoke the generated English build with `$template-skill-en-dev`. Ordinary ChatGPT web and mobile applications do not read local skill directories.

The English development response must be exactly the following, with the actual build ID substituted and the final paragraph rendered in italics:

```text
This skill is not implemented yet; it is a placeholder.

*Note: This is the dev build <buildId>. Do NOT use in production environment.*
```

Each development build uses its source template's placeholder as the first line; the blank line and italic notice are the same for both languages. The distributable source skills require only their single-line placeholder response. The generated development copy changes its name, invocation metadata, and final-response contract, copies every source payload file, and adds `dev-build.json`. It does not update root version or release metadata.

The build ID uses only the first 6 characters of the Git commit ID (`nogit` when no commit is available). Uncommitted file changes do not change the build ID; it is not a release version. Redeploy after every edit and start a fresh task. If the development skill is missing or appears stale, restart Codex before retesting.

Optionally create the Git-ignored `dev-deploy.local.json` manually to customize deployment. The command only reads this file and never generates or modifies it. Omit `skill` to deploy all skills with the shared settings:

```json
{
  "suffix": "dev",
  "workspace": "~/Dev/skills-template-playground"
}
```

Omit `target` to use `<workspace>/.agents/skills`. An explicit `target` retains its configured location even when `--workspace` changes. The same workspace-based default applies when calling `deployDev()` directly without a target.

To make one skill the local default, add `"skill": "template-skill-en"`; remove that field to return to deploying all skills. CLI arguments override that configuration:

```bash
npm run dev:deploy -- --suffix debug --workspace ~/Dev/skills-template-playground
npm run dev:deploy -- --target ~/Dev/skills-template-playground/.agents/skills --workspace ~/Dev/skills-template-playground
npm run dev:deploy -- --skill template-skill-en
npm run dev:deploy -- --help
```

`suffix` accepts `dev` or `debug`. Paths support `~`; relative paths resolve against the repository root. A debug build uses the corresponding invocation, such as `$template-skill-en-debug`, and retains the development-build notice. The workspace must remain outside the source repository. The installation root may be inside the workspace, but must not equal or contain it.

The deployer replaces only its own matching installations, identified by deployment metadata, source path, and generated skill name. It refuses unmanaged destinations, unsafe path overlaps, and symlink payloads. Existing workspace outputs are preserved.

Changing the default does not remove existing global development builds. For a one-time migration, remove any global `target` override from your local configuration, deploy and verify the workspace-local builds, then move only the matching old global installations to a backup directory outside skill discovery paths. Confirm their `dev-build.json` owner, source path, and generated name first. Normal deployments never clean up other installation roots.

## Host behavior acceptance

Runtime status for this template repository: actual host invocation has not yet been verified for either placeholder or its generated development build. Static checks, successful installation, and results from another repository do not establish these skills' runtime behavior.

Run `npm run check` first, then use fresh tasks in a separate workspace for each acceptance case. A new workspace may still expose user-level skills and enabled plugins; record their presence and check for same-named-skill interference.

Record the host and version, actual skill path, source revision or development build ID, workspace, user input, complete final response, and observed tool calls. Keep local logs under ignored `test-results/` and document verified results separately.

| Scenario | Expected result |
|---|---|
| Explicit source invocation for each language | Only that skill's exact placeholder response |
| Explicit source invocation with an additional work request | The same exact placeholder response |
| Explicit development invocation for each language | Its placeholder, a blank line, and the exact italic notice with its build ID |
| Explicit development invocation with an additional work request | The same development response |
| Ordinary request without naming either skill | Neither template is implicitly invoked |

For Codex, use `$template-skill-zh` and `$template-skill-en`, with the selected development suffix where applicable. For source skills in Claude Code, use `/template-skill-zh` and `/template-skill-en`. The development deployer targets local Codex; it does not establish Claude Code development-build support.

The source response permits only a transport-added trailing newline: no quotation marks, code fence, explanation, or follow-up question. Distinguish installation, host loading, and business execution. Installation copies files; the host may read or load a skill; placeholder business execution uses no tools. Absence of an invocation marker alone may not prove that no silent loading occurred, so state the evidence boundary of each observation.

If a host is unavailable, record installation and configuration results separately and mark runtime behavior unverified. Codex results do not establish Claude Code runtime behavior. Claim support for another host only after testing it.

## CI and repository releases

`check.yml` runs `npm ci` and `npm run check` on pushes, pull requests, and manual dispatches using Node.js 24. The Release Please workflow operates on `main` and uses the existing `GITHUB_TOKEN`.

The release configuration keeps one package at the repository root:

```json
{
  "separate-pull-requests": false,
  "packages": {
    ".": {
      "release-type": "simple",
      "initial-version": "0.1.0",
      "include-component-in-tag": false,
      "include-v-in-tag": true
    }
  }
}
```

Root `version.txt` starts at `0.0.0` and `.release-please-manifest.json` starts as `{}`. The first Release PR proposes `0.1.0` and updates root `version.txt`, root `CHANGELOG.md`, and the manifest's `.` entry together. Later releases update the same files. Each release tags the entire repository as `vX.Y.Z`, so all skills use that tag even when only one changes. The private, versionless development package does not introduce another release version.

Release PRs maintain versioned changelog entries. Before publication, record completed work under `Unreleased` and identify the intended release without assigning a publication date. When reviewing the first Release PR, move that draft's changes and verification status into the generated `0.1.0` entry and remove the superseded draft text. Release Please generates notes from commits; it does not automatically promote a hand-written `Unreleased` section. A manifest entry alone does not prove that a tag or GitHub Release exists. Verify actual publication before presenting a pinned installation URL as available.

After the first remote push, enable GitHub Actions to create and approve pull requests in repository settings. Review any workflow-run approval requested by GitHub for a Release PR created or updated by `GITHUB_TOKEN`. After checks pass, review and merge the Release PR; Release Please then creates the repository tag and GitHub Release. Verify these workflows in the new repository; local checks do not establish remote CI or publication. Do not rely on release events created with `GITHUB_TOKEN` to automatically trigger downstream publishing workflows.

Only after publishing `v0.1.0`, install that snapshot with:

```bash
npx skills add \
  https://github.com/zmjlucas/skills-template/tree/v0.1.0 \
  --skill template-skill-en \
  --agent codex
```

Use the new owner and repository name after adopting this template, and select your renamed skill as needed.
