# Testing

[← Development and setup](../development.md)

Read this before running or debugging tests.

## Checks

```sh
npm run check          # TypeScript and unit tests
npm run check:native   # Rust tests
npm run test:e2e       # Browser integration tests
```

Browser tests use installed Microsoft Edge on Windows. On macOS/Linux, run `npx playwright install chromium` first. Chinese OCR tests require a CJK system font, such as Microsoft JhengHei or Noto Sans CJK.

Rerun only the failures with `npx playwright test --last-failed`.

## When browser tests time out

If tests fail with `page.goto: Test timeout exceeded` or `net::ERR_ABORTED; maybe frame was detached?` and a blank page, check the dev server before the code. Run `curl -m 5 http://127.0.0.1:1420/` a few times: once the server has warmed up it answers in milliseconds, so no answer within 5 seconds means the dev server is stalled, not that a test is wrong.

- **Big folders inside the project.** Vite watches and scans everything under the project root. Agent sessions keep whole checkouts in `.claude/worktrees/`, each with its own `node_modules`, builds and HTML pages; watching them stalled the dev server for tens of seconds and timed out the command palette tests (October 2026). `vite.config.ts` therefore ignores `src-tauri/` and `.claude/` in the watcher and scans only this checkout's pages (`optimizeDeps.entries`). Keep those settings, and add any new folder that holds another checkout or large generated output.
- **Someone else's server.** Playwright reuses any server already on port 1420 (`reuseExistingServer`). A dev server started from another folder, such as an agent worktree, serves that folder's code. Stop it, or make sure the server on 1420 is yours, before running tests.
- **A busy machine.** Do not run `npm run check:native` (a Rust build) at the same time as `npm run test:e2e`; the build can slow page loads past the test timeouts.
