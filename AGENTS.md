# Publishing Flashcards

Follow the development and testing instructions in README.md.

- In a local Codex session, run `npm run publish:check` before attempting to publish. The check uses Git's actual remote and disables interactive authentication.
- In Windows Codex, run the check and any authorized Git push with host approval so Git can use the existing Windows credential helper. Keep the host approval scoped to the Flashcards check or push.
- If Git cannot authenticate, use an already authorized GitHub write connection if this session can access one. If no route is available, finish and verify the local work and report the specific publishing blocker once. Never start an OAuth flow, ask for credentials, or store a token as a workaround.
- For work started in a GitHub-connected Codex Cloud session, use a branch and pull request. GitHub Actions publishes Pages after the change lands on `main`.
- Keep private deck content and backups out of GitHub and deployment artifacts.
