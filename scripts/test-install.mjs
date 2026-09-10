import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = join(repoRoot, 'node_modules', 'skills', 'bin', 'cli.mjs');
const requiredFiles = ['LICENSE', 'SKILL.md', 'agents/openai.yaml'];
const targets = [
  { agent: 'codex', directory: '.agents' },
  { agent: 'claude-code', directory: '.claude' },
];

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(join(directory, entry.name), relative));
    } else {
      assert.ok(entry.isFile(), `Unexpected non-file payload: ${relative}`);
      files.push(relative);
    }
  }
  return files.sort();
}

async function runCli(args, cwd) {
  const env = {
    ...process.env,
    CI: 'true',
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    NO_COLOR: '1',
  };
  delete env.FORCE_COLOR;
  try {
    return await execFileAsync(process.execPath, [cli, ...args], {
      cwd,
      env,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Skills CLI failed: ${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
}

async function main() {
  const entries = await readdir(join(repoRoot, 'skills'), { withFileTypes: true });
  const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.ok(skillNames.length > 0, 'At least one skill is required for installation verification');

  for (const { agent, directory } of targets) {
    const workspace = await mkdtemp(join(tmpdir(), `skills-install-${agent}-`));
    try {
      const { stdout } = await runCli(['add', repoRoot, '--list'], workspace);
      for (const skillName of skillNames) {
        const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(stdout, new RegExp(`(?<![a-z0-9-])${escaped}(?![a-z0-9-])`), `The CLI must discover ${skillName}`);
        const source = join(repoRoot, 'skills', skillName);
        const payload = await listFiles(source);
        for (const required of requiredFiles) {
          assert.ok(payload.includes(required), `${skillName}: missing required file ${required}`);
        }

        await runCli([
          'add', repoRoot, '--skill', skillName, '--agent', agent, '--copy', '--yes',
        ], workspace);

        const installed = join(workspace, directory, 'skills', skillName);
        assert.deepEqual(await listFiles(installed), payload, `${agent}/${skillName}: installed file set differs`);
        for (const relative of payload) {
          const [original, copy] = await Promise.all([
            readFile(join(source, relative)),
            readFile(join(installed, relative)),
          ]);
          assert.deepEqual(copy, original, `${agent}/${skillName}: installed ${relative} differs from source`);
        }
        console.log(`PASS ${agent}/${skillName}: discovery and installation preserve all ${payload.length} payload files`);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
  console.log('Installation verified; model invocation behavior requires a separate runtime check.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
