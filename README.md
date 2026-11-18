# Flashcards

Personal flashcards for recognition, recall, and fixed-prompt exercises. Each deck can specify its front and back languages. Existing French/English backups remain supported.

The public GitHub Pages site contains the interface and application code. Course decks, answers, scores, sessions, flags, and edits are stored in the signed-in account's Supabase event stream. Row-level security and the sync function scope access to `auth.uid()`.

## Development

```sh
npm ci
cp .env.example .env
npm test
npm run build
npm start
```

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`. Only an anon or publishable key belongs in the frontend. The build rejects secret and service-role keys. The preview listens on `127.0.0.1:8797`.

## Deployment

GitHub Pages publishes `.github/workflows/pages.yml` after pushes to `main`. Set repository variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Keep the project's Supabase GitHub integration linked to this repository's `main` branch, working directory `.`. SQL migrations are in `supabase/migrations/`.

In Supabase Authentication URL Configuration, set the Site URL to `https://matthew-compton.github.io/flashcards/` and allow that exact redirect URL. Add `http://127.0.0.1:8797/` when testing locally. Email link sign-in is enabled through Supabase's email provider.

The manifest and service worker cache the app interface for offline use. The service worker only handles the listed same-origin app assets. Signed-in libraries and unsynced events live in a separate, account-scoped IndexedDB cache. Pending writes retry on reconnection and when the app returns to the foreground.

## Moving existing progress

Refresh the original local app and choose **Use synced app**. It opens the hosted app and transfers the current saved library through a one-time, origin-checked window handshake. Sign in on that computer to import the transferred library. Opening the same account on a phone then loads the cloud copy.

The original **Export backup** and the hosted **Import** also support the existing JSON format. Restoring a backup into an account with existing decks asks before replacing the synced library. Sessions and cumulative totals from the backup are preserved as the baseline, and new answers are logged individually. Migration snapshots stay in local storage until imported into the account, then are cleared.

## Sync behavior

Each answer, Undo, card edit, and flag change has a unique event identifier. The backend assigns a per-account revision under a row lock, so retries cannot add the same event twice. Devices pull every revision in order. Offline answers replay by study time, and each direction maintains its own schedule and session score. Undo targets the original answer identifier.

Replacing a library creates a new generation. Pending operations from an earlier generation remain in the event history and do not modify the replacement library. Simultaneous first-time imports choose the first committed initialization. Course content and backup files must stay out of the repository and build output.
