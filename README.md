# Flashcards

Personal flashcards for recognition, recall, and fixed-prompt exercises. Each deck can specify its front and back languages. Existing French/English backups remain supported.

The public GitHub Pages site contains the interface and application code. Course decks, answers, scores, sessions, flags, and edits are stored in the signed-in account's Supabase event stream. Row-level security and the sync function scope access to `auth.uid()`.

## Development

Use Node.js 22 to match GitHub Actions.

```sh
npm ci
cp .env.example .env
npm test
npm run build
npm start
```

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`. Only an anon or publishable key belongs in the frontend. The build rejects secret and service-role keys. The preview listens on `127.0.0.1:8797`.

## Tests

- `npm test` runs the domain and storage tests. `npm run test:coverage` reports coverage for modules loaded by that suite.
- `npm run test:db` applies the production migrations to disposable, embedded Postgres. CI also runs the suite against PostgreSQL 17 with two concurrent connections. For that mode locally, point `FLASHCARDS_TEST_DATABASE_URL` to an empty `flashcards_test` database on localhost.
- `npx playwright install chromium` followed by `npm run test:browser` runs the real app with synthetic account data. Playwright manages the fixture server in its test process, so these tests run in the Windows Codex sandbox. Set `FLASHCARDS_TEST_CHROME` to a local Chrome executable to use it for the Chromium projects. Install WebKit and set `FLASHCARDS_TEST_WEBKIT=1` to add the iPhone layout tests. Device checks for browser context menus and navigation gestures still need physical phones.
- `npm run bench:replay` measures event replay on a synthetic 44-deck collection. It excludes IndexedDB, networking, and browser rendering.

Pull requests and Pages deployments run the quality workflow. The database and browser tests use isolated fixtures.

## Deployment

GitHub Pages publishes `.github/workflows/pages.yml` after pushes to `main`. Set repository variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Keep the project's Supabase GitHub integration linked to this repository's `main` branch, working directory `.`. SQL migrations are in `supabase/migrations/`.

Run `npm run publish:check` to check whether the current command session can push the checked-out commit to `origin/main`. It uses a dry run with credential prompts disabled. A public clone or fetch can succeed even when the session cannot push.

The installed Windows release command in `AGENTS.md` uses the existing Windows GitHub CLI credential with a reusable host approval. It verifies that the new commit descends from the current GitHub `main` tip, runs Git's dry run, and binds any push to that exact tip. After pushing, check that the Pages workflow deploys the pushed commit.

In Supabase Authentication URL Configuration, set the Site URL to `https://matthew-compton.github.io/flashcards/` and allow that exact redirect URL. Add `http://127.0.0.1:8797/` when testing locally. Email link sign-in is enabled through Supabase's email provider.

Opening or refreshing the app online checks for the latest complete app build. The service worker caches the interface and its matching JavaScript bundle for offline use. Signed-in libraries and unsynced events live in a separate, account-scoped IndexedDB cache. Opening or refreshing also syncs saved progress when online. Settings has a manual **Sync now** button and shows any changes still saved on the current device.

## Moving existing progress

Refresh the original local app and choose **Use synced app**. It opens the hosted app and transfers the current saved library through a one-time, origin-checked window handshake. Sign in on that computer to import the transferred library. Opening the same account on a phone then loads the cloud copy.

The original **Export backup** and the hosted **Import** also support the existing JSON format. Restoring a backup into an account with existing decks asks before replacing the synced library. Sessions and cumulative totals from the backup are preserved as the baseline, and new answers are logged individually. Migration snapshots stay in local storage until imported into the account, then are cleared.

## Sync behavior

Each answer, Undo, card edit, and flag change has a unique event identifier. The backend assigns a per-account revision under a row lock, so retries cannot add the same event twice. Devices pull every revision in order. Offline answers replay by study time, and each direction maintains its own schedule and session score. Undo targets the original answer identifier.

Replacing a library creates a new generation. Pending operations from an earlier generation remain in the event history and do not modify the replacement library. Simultaneous first-time imports choose the first committed initialization. Course content and backup files must stay out of the repository and build output.

New events carry a schema version. The sync service accepts older events with the same shape and validates new inserts before committing a batch. Client validation rejects an invalid response before writing it to the local cache. Legacy backups with a calendar due date and no time zone are converted using UTC so a restore produces the same schedule on any device.

The study round controller owns reveal, grade, skip, and undo. Review selection uses a clock and shuffle source that can be supplied by tests. Flagging, rewriting, and splitting a card produce explicit event batches. A split retains the first card's identity for its flag, assigns new IDs to added cards, and restarts the affected review schedules while keeping the deck scores and session history.
