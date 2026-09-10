# skills-template

[English](README.md) | [简体中文](README.zh-cn.md)

A repository template for developing and releasing Agent Skills, with static validation, installation tests, local development deployment, and repository-wide versioning. It provides two placeholder skills for developers:

| Skill | Developer documentation language | Exact response to explicit invocation |
|---|---|---|
| [`template-skill-en`](skills/template-skill-en/SKILL.md) | English | `This skill is not implemented yet; it is a placeholder.` |
| [`template-skill-zh`](skills/template-skill-zh/SKILL.md) | 中文 | `此技能尚未实现，仅为占位模板。` |

Both skills require explicit user invocation. They return placeholder text without performing business work or calling tools.

## Start from the template

1. On GitHub, select **Use this template → Create a new repository**, then clone the new repository.
2. Replace `zmjlucas/skills-template` and local paths in the documentation with your repository details, and update the package name in both `package.json` and `package-lock.json`.
3. Choose your preferred language template, then update its directory name, `SKILL.md` name and content, and the display text and `default_prompt` in `agents/openai.yaml`. Remove examples you do not need.
4. Update the default development skill, playground name, deployment owner identifier, and related tests. Preserve license notices required by the code you use.
5. Run `npm ci` and `npm run check`, then verify actual invocation separately in each target host.

See the [development guide](docs/DEVELOPMENT.md#customize-the-template) for the file checklist and renaming steps. The repository shares one version; adding a skill does not require another release package.

## Installation

After these files reach GitHub, install either template from the default branch. The following examples use the English template; replace `template-skill-en` with `template-skill-zh` for the Chinese template:

```bash
# Codex
npx skills add zmjlucas/skills-template --skill template-skill-en --agent codex

# Claude Code
npx skills add zmjlucas/skills-template --skill template-skill-en --agent claude-code
```

To install from a local checkout, use the clone's absolute path:

```bash
npx skills add /absolute/path/to/skills-template --skill template-skill-en --agent codex
```

An installed copy does not update when source files change. Reinstall after editing, and identify both the skill and host when updating or removing it:

```bash
npx skills add zmjlucas/skills-template --skill template-skill-en --agent codex
npx skills remove template-skill-en --agent codex
```

The following version-pinned URL becomes available only after the `v0.1.0` tag is published:

```bash
npx skills add \
  https://github.com/zmjlucas/skills-template/tree/v0.1.0 \
  --skill template-skill-en \
  --agent codex
```

## Explicit invocation

| Host | English template |
|---|---|
| Codex | `$template-skill-en` |
| Claude Code | `/template-skill-en` |

An invocation returns only the corresponding exact response in the opening table. Ordinary natural-language requests must not load either skill implicitly. Codex declares this with `allow_implicit_invocation: false`; Claude Code declares it with `disable-model-invocation: true`.

## Development and verification

Use Node.js 24 and npm:

```bash
npm ci
npm run check
```

After modifying skill sources, deploy a local development build:

```bash
# All skills (default)
npm run dev:deploy

# English template only
npm run dev:deploy -- --skill template-skill-en
```

By default, this discovers every skill directory under `skills/` and installs its development build under `<workspace>/.agents/skills/`, including `template-skill-zh-dev` and `template-skill-en-dev`. It creates a shared, separate `skills-template-playground` workspace in the system temporary directory and prints the actual paths, build ID, and invocation for each skill. Select the printed workspace and start a new local task in the Codex desktop application, or enter that directory in a terminal and run `codex`, then send the printed invocation. Existing workspace contents are preserved alongside `.agents/skills`; use `--workspace` with a new directory when you need a fresh test environment. Unless `target` is explicitly configured, the installation directory follows the final workspace, so development builds are local to that workspace and its subdirectories. This workflow targets the local Codex desktop application and CLI. Ordinary ChatGPT web and mobile applications do not read skill directories on your computer.

Development deployment copies the complete skill payload, adds `-dev` to its name and invocation metadata, and appends an italic notice to the final response:

*Note: This is the dev build \<buildId\>. Do NOT use in production environment.*

The build ID uses only the first 6 characters of the Git commit ID (`nogit` when no commit is available). Uncommitted file changes do not change the build ID. Development deployment leaves the source skill and repository release version unchanged. Redeploy after every edit and test in a new task; restart Codex if its skill list does not update. Configure deployment with `--suffix debug`, `--target`, `--workspace`, or an optional, manually created, Git-ignored `dev-deploy.local.json`. The command only reads this file; it never generates it. Omit its `target` field to use `<workspace>/.agents/skills`; an explicit target keeps its configured location even when the workspace changes. Omit its `skill` field to keep the all-skills default; setting `skill` selects one source, and `--skill` overrides that selection. See [local development deployment](docs/DEVELOPMENT.md#local-development-deployment) for complete examples.

Checks cover skill metadata, explicit-invocation policies, repository release metadata, and real CLI installation for Codex and Claude Code. Installation tests compare every distributed file byte for byte; each template contains `SKILL.md`, `LICENSE`, and `agents/openai.yaml`.

Structural and installation checks do not establish host runtime behavior. Actual host invocation has not yet been verified for either new placeholder or its development build. See the [development guide](docs/DEVELOPMENT.md#host-behavior-acceptance) for acceptance steps.

## Repository releases

The entire repository shares root `version.txt`, root `CHANGELOG.md`, one Release PR, a `vX.Y.Z` tag, and one GitHub Release. New skills join this version without separate version files or release components.

The initial version is `0.0.0`, with an empty `{}` manifest; the first Release PR starts at `0.1.0`. Release PRs maintain version and changelog entries. A manifest entry alone does not prove that a tag or Release has been published. New repository maintainers must configure GitHub Actions PR permissions and verify remote workflows; see the [release procedure](docs/DEVELOPMENT.md#ci-and-repository-releases).
