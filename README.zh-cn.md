# skills-template

[English](README.md) | [简体中文](README.zh-cn.md)

用于开发和发布 Agent Skills 的仓库模板，包含静态验证、安装测试、本地开发部署和统一版本发布流程。提供两个供开发者参考的占位 skill：

| Skill | 开发者文档语言 | 主动调用后的固定响应 |
|---|---|---|
| [`template-skill-zh`](skills/template-skill-zh/SKILL.md) | 中文 | `此技能尚未实现，仅为占位模板。` |
| [`template-skill-en`](skills/template-skill-en/SKILL.md) | English | `This skill is not implemented yet; it is a placeholder.` |

两个 skill 都需要用户主动调用，目前仅返回占位文本，不执行实际业务或调用工具。

## 从模板开始

1. 在 GitHub 上选择 **Use this template → Create a new repository**，然后 clone 新仓库。
2. 将文档中的 `zmjlucas/skills-template` 和本地路径改成新仓库地址；同步修改 `package.json` 与 `package-lock.json` 中的包名。
3. 选择需要的语言模板，修改 skill 目录名、`SKILL.md` 的 `name` 和内容，以及 `agents/openai.yaml` 的展示文案和 `default_prompt`。移除不需要的示例。
4. 同步更新开发部署的默认 skill、playground 名称、部署 owner 标识和相关测试。保留所用代码要求的许可证声明。
5. 运行 `npm ci` 和 `npm run check`，再分别验证目标宿主中的实际调用。

文件清单和改名步骤见[开发指南](docs/DEVELOPMENT.md#customize-the-template)。仓库共用一个版本；新增 skill 不需要单独配置发布包。

## 安装

这些文件推送到 GitHub 后，可以从默认分支安装任一模板。以下以中文版为例，将 `template-skill-zh` 替换为 `template-skill-en` 即可安装英文版：

```bash
# Codex
npx skills add zmjlucas/skills-template --skill template-skill-zh --agent codex

# Claude Code
npx skills add zmjlucas/skills-template --skill template-skill-zh --agent claude-code
```

如需安装本地 checkout，请使用 clone 的绝对路径：

```bash
npx skills add /absolute/path/to/skills-template --skill template-skill-zh --agent codex
```

安装副本不会随源文件自动更新。修改后重新安装；更新或移除时同时限定 skill 和宿主：

```bash
npx skills add zmjlucas/skills-template --skill template-skill-zh --agent codex
npx skills remove template-skill-zh --agent codex
```

下面的固定版本地址只有在 `v0.1.0` tag 实际发布后才能使用：

```bash
npx skills add \
  https://github.com/zmjlucas/skills-template/tree/v0.1.0 \
  --skill template-skill-zh \
  --agent codex
```

## 主动调用

| 宿主 | 中文模板 |
|---|---|
| Codex | `$template-skill-zh` |
| Claude Code | `/template-skill-zh` |

调用后只返回开头表格中对应的固定响应。普通自然语言请求不应自动加载这两个 skill。Codex 通过 `allow_implicit_invocation: false`、Claude Code 通过 `disable-model-invocation: true` 声明这一限制。

## 开发与验证

使用 Node.js 24 和 npm：

```bash
npm ci
npm run check
```

修改 skill 源文件后，部署本地开发版：

```bash
# All skills (default)
npm run dev:deploy

# Chinese template only
npm run dev:deploy -- --skill template-skill-zh
```

默认发现 `skills/` 下的所有 skill 目录，并将各自的开发版安装到 `<workspace>/.agents/skills/`，包括 `template-skill-zh-dev` 和 `template-skill-en-dev`。命令会在系统临时目录中创建独立、共用的 `skills-template-playground` 测试工作区，并为每个 skill 打印实际路径、build ID 和调用方式。在 Codex 桌面应用中选择打印的工作区并新建本地任务，或在终端进入该目录后运行 `codex`，然后发送打印的调用指令。已有工作区内容会与 `.agents/skills` 一起保留；如需新的测试环境，通过 `--workspace` 指定新目录。除非显式配置 `target`，安装目录会跟随最终工作区，因此开发版仅在该工作区及其子目录中可见。这个流程用于本地 Codex 桌面应用和 CLI，普通 ChatGPT 网页或手机应用不会读取电脑上的 skill 目录。

开发部署会复制全部 skill 文件、为名称和调用元数据添加 `-dev` 后缀，并在最终输出末尾追加斜体提示：

*Note: This is the dev build \<buildId\>. Do NOT use in production environment.*

build ID 仅使用 Git commit ID 的前 6 位（无可用提交时为 `nogit`）。未提交的文件修改不会改变 build ID。源 skill 和统一发布版本不受开发部署影响。每次修改后重新部署，并在新任务中测试；若技能列表没有更新，重启 Codex。通过 `--suffix debug`、`--target`、`--workspace` 或可选、手动创建且不纳入 Git 的 `dev-deploy.local.json` 配置部署。命令只读取这个文件，不会自动生成它。省略其中的 `target` 字段即可使用 `<workspace>/.agents/skills`；显式设置 target 后，修改 workspace 不会改变该安装位置。省略其中的 `skill` 字段即可保留默认部署全部 skill 的行为；设置 `skill` 会限定为单个源 skill，`--skill` 可覆盖这一选择。完整示例见[本地开发部署](docs/DEVELOPMENT.md#local-development-deployment)。

检查覆盖 skill 元数据、主动调用配置、统一发布元数据，以及 Codex 与 Claude Code 的真实 CLI 安装。安装测试逐字节比较全部分发文件；每个模板包含 `SKILL.md`、`LICENSE` 和 `agents/openai.yaml`。

结构与安装验证不等于宿主运行行为验证。这两个新占位模板及其开发版尚未进行宿主实际调用验证；验收方法见[开发指南](docs/DEVELOPMENT.md#host-behavior-acceptance)。

## 统一发布

整个仓库共用根目录的 `version.txt`、`CHANGELOG.md`、一个 Release PR、`vX.Y.Z` tag 和 GitHub Release。新增 skill 沿用这一版本，不创建独立的版本文件或发布组件。

初始版本为 `0.0.0`，manifest 为 `{}`；首个 Release PR 从 `0.1.0` 开始。Release PR 维护版本和变更记录，manifest 本身不能证明 tag 或 Release 已发布。新仓库维护者需配置 GitHub Actions 的 PR 权限，并验证远程工作流；详见[发布流程](docs/DEVELOPMENT.md#ci-and-repository-releases)。
