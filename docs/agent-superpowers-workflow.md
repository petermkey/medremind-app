# Superpowers Workflow Adapter

Date: 2026-04-25
Status: Codex and Claude workflow adapter for MedRemind

## 1. Purpose

This repository uses [Superpowers](https://github.com/obra/superpowers) as an external, updateable agent skills library. Superpowers is not vendored into this repository. It provides process skills for planning, test-first development, systematic debugging, code review, verification, and agent coordination.

The Codex installation path is:

```bash
~/.codex/superpowers
~/.agents/skills/superpowers -> ~/.codex/superpowers/skills
```

After installation or update, restart Codex App so native skill discovery can load the skills.

## 2. Instruction Priority

When Superpowers guidance conflicts with this repository, use this order:

1. System and developer instructions for the active agent runtime.
2. `AGENTS.md` and the current source-of-truth documents listed there.
3. Task-specific user instructions.
4. Superpowers skills.

Superpowers should improve execution discipline, not override MedRemind governance. In particular:

- Keep all repository documentation in English.
- Start implementation work from clean `main`.
- Use `codex/<sprint-id>-<slice-name>` branch names for implementation branches.
- Keep one concern per branch.
- Do not push, open PRs, merge, or discard work unless explicitly requested.
- Use `chrome-devtools` by default for live browser inspection, localhost UI checks, console/network debugging, screenshots, Lighthouse, and frontend performance analysis.

## 3. Adopted Skills

Use these Superpowers skills directly when their trigger conditions apply:

- `brainstorming` for feature or behavior design before implementation.
- `writing-plans` for multi-step implementation planning.
- `test-driven-development` for features, bug fixes, refactors, and behavior changes when a meaningful automated test is feasible.
- `systematic-debugging` for bugs, failed tests, build failures, production issues, unexpected behavior, or performance problems.
- `verification-before-completion` before claiming work is complete, fixed, passing, or ready.
- `requesting-code-review` before merge or after substantial implementation work.
- `receiving-code-review` when handling review feedback from users, agents, GitHub, or external reviewers.
- `dispatching-parallel-agents` and `subagent-driven-development` when tasks are independent and the active runtime supports subagents.
- `writing-skills` when creating or modifying personal or project skills.

## 4. MedRemind Constraints on Superpowers Workflows

Apply these local constraints when using Superpowers:

- `using-git-worktrees`: follow MedRemind branch naming and preflight rules. Do not add `.gitignore` entries or create commits from `main`; if a repo change is needed, create an appropriate slice branch first.
- `finishing-a-development-branch`: verify first, then present options. Do not merge locally, push, create a PR, delete a branch, or remove a worktree unless the user explicitly chooses that action.
- `executing-plans`: prefer `subagent-driven-development` when available and when tasks have independent write scopes. Use inline execution only when subagents are unavailable, the plan is tightly coupled, or the user asks for inline execution.
- `test-driven-development`: if the project has no suitable test surface for a small docs/config-only change, document the reason and use `git diff --check`, targeted searches, or manual verification instead.
- `systematic-debugging`: root cause evidence comes before fixes. For lifecycle, persistence, auth, sync, or notification issues, read the relevant current source-of-truth docs before changing code.

## 5. Claude and Cloud Usage

For Claude Code or Claude Cloud workflows, install Superpowers through the official marketplace when available:

```text
/plugin install superpowers@claude-plugins-official
```

Alternative upstream marketplace path:

```text
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Do not copy upstream Claude-specific repository instructions into this project unless they are converted into MedRemind-specific, repo-neutral English documentation and reviewed as a normal docs change.

## 6. Maintenance and Rollback

Update Superpowers with:

```bash
cd ~/.codex/superpowers && git pull
```

Rollback Codex discovery with:

```bash
rm ~/.agents/skills/superpowers
```

The upstream clone can remain in `~/.codex/superpowers` for later use, or be removed separately if no longer needed.
