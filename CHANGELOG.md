# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 (2026-09-10)


### Features

* initialize skills template for v0.1.0 ([7d19d46](https://github.com/zmjlucas/skills-template/commit/7d19d46251734d84bd34718aebf404cfdb00d010))

## [Unreleased]

Planned initial release: **0.1.0**. Release Please will set the repository version
and create the tag and GitHub Release through the first Release PR.

### Added

- English and Simplified Chinese placeholder skills, each with an exact response
  contract, explicit-invocation metadata for Codex and Claude Code, and an MIT
  license included in its installable payload.
- Local development deployment that discovers all skills by default, supports
  selecting one skill, and installs `dev` or `debug` builds inside a separate
  workspace. Builds include renamed invocation metadata, a six-character Git
  commit build ID, deployment metadata, and a development-only response notice.
- Command-line deployment overrides and an optional, ignored local configuration
  file for the skill, suffix, target, and workspace.
- Managed redeployment that preserves workspace outputs and refuses unmanaged
  installations, unsafe path overlaps, and symlink payloads or destinations.
- Static validation of skill metadata, explicit-invocation policies, required
  payload files, and the shared repository release configuration.
- Automated validation and deployment tests, plus real Skills CLI discovery and
  installation checks for both templates in Codex and Claude Code. Installation
  checks compare every distributed file byte for byte.
- A Node.js 24 development workflow with locked npm dependencies and GitHub
  Actions checks on pushes, pull requests, and manual dispatches.
- Repository-wide Release Please automation using one root version, changelog,
  manifest entry, Release PR, `vX.Y.Z` tag, and GitHub Release.
- English and Simplified Chinese READMEs and a development guide covering template
  customization, installation, local deployment, host acceptance, and releases.

### Verification status

- Actual host invocation remains unverified for both source placeholders and
  generated development builds. Static validation and installation checks do not
  establish runtime behavior; see the
  [host acceptance procedure](docs/DEVELOPMENT.md#host-behavior-acceptance).
