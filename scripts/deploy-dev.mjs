import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildDev, manifestName, owner, validateIdentity } from "./lib/dev-build.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const keys = ["skill", "suffix", "target", "workspace"];

function defaults(repoRoot) {
  return {
    repoRoot,
    suffix: "dev",
    workspace: join(tmpdir(), "skills-template-playground"),
  };
}

function expandPath(path, repoRoot) {
  if (typeof path !== "string" || !path.trim()) throw new Error("Target and workspace paths must be nonempty strings.");
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(repoRoot, path);
}

function resolvePaths(options, repoRoot) {
  options.workspace = expandPath(options.workspace, repoRoot);
  options.target = options.target === undefined
    ? join(options.workspace, ".agents", "skills")
    : expandPath(options.target, repoRoot);
  return options;
}

export async function resolveOptions(args, repoRoot = repository) {
  let config = {};
  try {
    config = JSON.parse(await readFile(join(repoRoot, "dev-deploy.local.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Cannot read dev-deploy.local.json: ${error.message}`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).some((key) => !keys.includes(key))) {
    throw new Error(`dev-deploy.local.json must be an object containing only: ${keys.join(", ")}.`);
  }
  const options = { ...defaults(repoRoot), ...config };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, "");
    if (!args[index].startsWith("--") || !keys.includes(key)) throw new Error(`Unknown option: ${args[index]}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    options[key] = value;
  }
  resolvePaths(options, repoRoot);
  if (options.skill !== undefined) validateIdentity(options.skill, options.suffix);
  return options;
}

async function info(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Resolve existing ancestors too, so a symlink cannot disguise a source-tree target.
async function canonical(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (await info(path)) throw new Error(`Path contains a broken symlink: ${path}`);
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), basename(path));
  }
}

function within(path, parent) {
  const rel = relative(parent, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function managedDestination(destination, source, name) {
  const existing = await info(destination);
  if (!existing) return false;
  if (existing.isSymbolicLink()) throw new Error(`Refusing symlink destination: ${destination}`);
  if (existing.isDirectory()) {
    try {
      const manifestPath = join(destination, manifestName);
      if (!(await lstat(manifestPath)).isFile()) throw new Error("Invalid manifest");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.schema === 1 && manifest.owner === owner && manifest.source === source && manifest.name === name) return true;
    } catch { /* Treat missing or malformed ownership metadata as unmanaged. */ }
  }
  throw new Error(`Refusing unmanaged destination: ${destination}. Choose another target or move the existing installation yourself.`);
}

export async function deployDev(input = {}) {
  const options = { ...defaults(input.repoRoot || repository), ...input };
  const name = validateIdentity(options.skill, options.suffix);
  const repoRoot = await realpath(options.repoRoot);
  resolvePaths(options, repoRoot);
  const sourcePath = join(repoRoot, "skills", options.skill);
  if (!(await lstat(sourcePath)).isDirectory()) throw new Error("Skill source must be a directory, not a symlink.");
  const source = await realpath(sourcePath);
  const targetRoot = await canonical(options.target);
  const workspace = await canonical(options.workspace);
  const skillsRoot = await realpath(join(repoRoot, "skills"));
  const target = join(targetRoot, name);
  if (within(target, skillsRoot) || within(skillsRoot, target)) throw new Error("Development target must not overlap the distributable skills source tree.");
  if (within(workspace, repoRoot) || within(repoRoot, workspace)) throw new Error("Test workspace must be outside the source repository.");
  if (within(workspace, targetRoot)) throw new Error("Skill installation root must not equal or contain the test workspace.");
  await managedDestination(target, source, name);
  const build = await buildDev({ repoRoot, source, skill: options.skill, suffix: options.suffix });
  // Complete source validation before creating either output directory.
  await mkdir(workspace, { recursive: true });
  await mkdir(targetRoot, { recursive: true });
  const lock = join(targetRoot, `.${name}.deploy-lock`);
  try { await mkdir(lock); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Deployment lock exists: ${lock}. If no deployment is running, remove the empty lock directory and retry.`);
    throw error;
  }
  let staging;
  try {
    const replacing = await managedDestination(target, source, name);
    staging = await mkdtemp(join(targetRoot, `.${name}.stage-`));
    const payload = join(staging, "payload");
    const backup = join(staging, "previous");
    for (const file of build.files) {
      const path = join(payload, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.bytes);
      await chmod(path, file.mode);
    }
    if (replacing) await rename(target, backup);
    try { await rename(payload, target); }
    catch (error) {
      if (replacing) {
        try { await rename(backup, target); }
        catch (restoreError) {
          staging = undefined; // Preserve the previous build if recovery fails.
          throw new Error(`Deployment failed: ${error.message}. Restore the previous build from ${backup}: ${restoreError.message}`);
        }
      }
      throw error;
    }
    return { ...build, target, workspace };
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { await rm(lock, { recursive: true, force: true }); }
  }
}

const help = `Usage: npm run dev:deploy -- [options]

Build and install explicitly invoked development skills for local Codex.

  --skill NAME       Deploy only this source skill (default: all skills/ directories)
  --suffix NAME      dev or debug (default: dev)
  --target PATH      Parent skill directory (default: <workspace>/.agents/skills)
  --workspace PATH   Separate test workspace (default: OS temp/skills-template-playground)
  --help             Show this help

Defaults can be overridden in optional, ignored dev-deploy.local.json; CLI arguments win.
Omit skill from that file to deploy all skills. This command does not create it.
Omit target to install inside the final workspace, including a --workspace override.
Paths support ~/ and resolve relative to this repository. Existing workspace
files are retained alongside .agents/skills. Only this deployer's matching
installations are replaced.
`;

async function main() {
  if (process.argv.slice(2).includes("--help")) { console.log(help); return; }
  const options = await resolveOptions(process.argv.slice(2));
  let skills = [options.skill];
  if (options.skill === undefined) {
    const entries = await readdir(join(options.repoRoot, "skills"), { withFileTypes: true });
    // Include symlinks so deployDev rejects them instead of silently skipping them.
    skills = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name).sort();
    if (!skills.length) throw new Error("No skills found in skills directory.");
  }
  for (const skill of skills) {
    const result = await deployDev({ ...options, skill });
    console.log(`Installed: ${result.target}\nBuild: ${result.buildId}\nTest workspace: ${result.workspace}\nInvoke: $${result.name}\n`);
  }
  console.log("Open the test workspace in local Codex and start a fresh task or CLI session.\nIf a skill or an update does not appear, restart Codex.\nInstallation verified; runtime behavior requires a separate invocation test.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`Dev deployment failed: ${error.message}`); process.exitCode = 1; });
}
