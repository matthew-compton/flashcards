# Publishing Flashcards

Follow the development and testing instructions in README.md.

- Run unit, database, build, and Playwright checks in the sandbox. The Playwright fixture server starts and stops within the test runner.
- For an authorized release from this Windows checkout, use the installed command below as a standalone host invocation. Codex's reusable rule applies to this exact command. It snapshots local `main`, checks the GitHub tip, and runs the non-interactive dry run before any push.
- For other local checkouts, run `npm run publish:check` before attempting to publish. The check uses Git's actual remote and disables interactive authentication.
- If Git cannot authenticate, use an already authorized GitHub write connection if this session can access one. If no route is available, finish and verify the local work and report the specific publishing blocker once. Never start an OAuth flow, ask for credentials, or store a token as a workaround.
- For work started in a GitHub-connected Codex Cloud session, use a branch and pull request. GitHub Actions publishes Pages after the change lands on `main`.
- Keep private deck content and backups out of GitHub and deployment artifacts.

```powershell
C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File C:/Users/Admin/.codex/host-tools/flashcards/Release.ps1
```
