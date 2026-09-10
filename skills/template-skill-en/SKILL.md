---
name: template-skill-en
description: Placeholder skill for English-speaking developers to invoke explicitly and inspect a minimal skill structure.
license: MIT
disable-model-invocation: true
---

# English Skill Template

This skill provides a minimal structure to copy. Business functionality is not implemented yet.

## Invocation behavior

When the user explicitly invokes this skill, return exactly this single line
of plain text, then stop:

This skill is not implemented yet; it is a placeholder.

The response contains no quotation marks, Markdown formatting, explanations,
or questions. The placeholder workflow uses no tools, reads or modifies no
files, and performs no business task included with the invocation.

## Developer customization notes

This section is a reference for developers adapting the template, not a workflow to execute during invocation.

1. Replace the directory name and frontmatter `name` with the actual skill name, using lowercase letters, digits, and hyphens.
2. Replace `description` with the actual purpose, and update the display name, short description, and `$skill-name` invocation example in `agents/openai.yaml`.
3. Replace the placeholder behavior with real input requirements, workflow, and output contract. Add `scripts/`, `references/`, or `assets/` only when needed.
4. Keep the skill's `LICENSE` and existing copyright notices. This repository defaults to explicit user invocation; preserve the invocation policies in both metadata files.

Remove this section after customization. Version and release history are maintained at the repository root.
