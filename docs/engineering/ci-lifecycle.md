# CI lifecycle and required check

The `test` workflow handles pull requests opened, synchronized, reopened, marked ready for review, or converted to draft, plus pushes to `main`. Same-ref runs cancel older runs, and every job has a timeout.

| Event state | `fast` | `full` | `dynamics` | `test / required` |
| --- | --- | --- | --- | --- |
| Draft pull request | Runs bounded A1 checks | Skipped | Skipped | Fails with `draft_deferred` after fast succeeds; otherwise fails with the fast job status reason |
| Ready pull request | Runs | Runs all type, contract, unit, and build checks | Runs dynamics validation | Green only when `full` and `dynamics` succeed; `fast` may be skipped or successful |
| Push to `main` | Runs | Runs all type, contract, unit, and build checks | Runs dynamics validation | Green only when `full` and `dynamics` succeed; `fast` may be skipped or successful |
| Required work failed, cancelled, stale, skipped, or unrun | Status recorded | Status recorded | Status recorded | Fails with a reason naming the unsuccessful work |

`required` is the stable aggregate job and uses `always()` so it reports deferred or unsuccessful work. Configure branch protection to require **`test / required`** (workflow name `test`, job `required`). Do not require the conditional `full` or `dynamics` jobs directly: they are intentionally skipped on draft pull requests. Branch protection settings and remote event replay have not been exercised by this local change.

Draft checks run only the three focused A1 tests. Ready pull requests and pushes run the complete local CI gates, with Python dynamics validation in a separate job. Caches are limited to npm and pip package caches.

For local worktrees, install dependencies from each worktree with `npm ci`. Use distinct ports such as `HUMAN3D_WEB_PORT=5174`, `HUMAN3D_PREVIEW_PORT=4174`, and `HUMAN3D_PORT=8789`; check selected ports and workspace links with `npm run worktree:check -- --source-root <source-checkout> --worktree-root <worktree>`. Browser QA URLs can be overridden with `QA_WEB_URL` and `QA_SERVICE_URL`. Set `HUMAN3D_BUILD_OUT_DIR` to `dist` (the default) or a nested path under `.out`, such as `.out/<worktree>/<run>/build`. Vite clears the selected output directory, so use a dedicated build directory; paths that leave these generated areas after symlink resolution are rejected.
