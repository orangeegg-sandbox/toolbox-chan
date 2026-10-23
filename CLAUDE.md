## Project rules
Read `AGENTS.md` for structure, working rules and checks. In particular: if browser tests time out on `page.goto` with a blank page, the Vite dev server is usually stalled, not the code. Agent worktrees under `.claude/worktrees/` and other large folders inside the project slow it down. Keep `vite.config.ts` ignoring them, run the Rust checks separately, and see "When browser tests time out" in `docs/development.md`.

## Other agents
This project uses tower (rules in TOWER.md). Before a large task, or a subtask you could hand off, use the `tower` skill.
