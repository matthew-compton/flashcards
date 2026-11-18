import { createClient } from '@supabase/supabase-js';
import { StudyStore } from './storage.js';
import { createAccountLifecycle } from './account.js';
import { receiveMigration, stagedMigration, clearMigration, migrationHash } from './transfer.js';

const projectUrl = __SUPABASE_URL__;
const publicKey = __SUPABASE_PUBLISHABLE_KEY__;
const $ = id => document.getElementById(id);

function showSyncIssue(message) {
  $('sync-status').textContent = message;
  $('sync-status').hidden = !message;
}

export async function startCloud({ onStore, onLibrary, onSignOut }, {
  client: providedClient, openStore = (client, owner) => new StudyStore(client, owner).open(),
  online = () => navigator.onLine
} = {}) {
  $('export').hidden = $('import').hidden = true;
  receiveMigration();
  if (!providedClient && (!projectUrl || !publicKey)) {
    $('auth-message').textContent = 'The cloud connection has not been configured for this build.';
    $('send-signin').disabled = true;
    return;
  }
  const client = providedClient ?? createClient(projectUrl, publicKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  let migratingStore;

  function showAccountIdentity(user) {
    const email = user?.email ?? '';
    const offline = !online();
    $('account-label').textContent = email ? 'Signed in as' : user ? (offline ? 'Offline account' : 'Signed in') : '';
    $('account-email').textContent = email || (user ? (offline ? 'Email unavailable offline' : 'Email unavailable') : '');
    $('account-initial').textContent = email.charAt(0).toUpperCase();
    $('account-initial').hidden = !email;
    $('sign-out').title = email ? 'Signed in as ' + email : 'Sign out';
  }

  async function transferProgress() {
    const activeStore = account.store;
    if (!activeStore || migratingStore === activeStore || activeStore.status !== 'Synced') return;
    migratingStore = activeStore;
    try {
      const library = stagedMigration();
      if (!library) return;
      const sourceHash = await migrationHash(library);
      if (account.store !== activeStore) return;
      const migrated = activeStore.records.some(record => record.event.payload?.sourceHash === sourceHash);
      if (migrated) { clearMigration(); return; }
      if (activeStore.generation) {
        $('migration-panel').hidden = false;
        return;
      }
      await activeStore.importLibrary(library, { sourceHash });
      if (account.store !== activeStore) return;
      clearMigration();
      $('migration-panel').hidden = true;
    } catch (error) {
      if (account.store === activeStore) showSyncIssue('Migration pending · ' + error.message);
    } finally {
      if (migratingStore === activeStore) migratingStore = null;
    }
  }

  function status(event) {
    const activeStore = account.store;
    if (!activeStore) return;
    const count = activeStore.pending.length;
    const pending = count ? count + (count === 1 ? ' change saved' : ' changes saved') + ' on this device.' : '';
    const failed = activeStore.error && activeStore.status !== 'Syncing…';
    showSyncIssue(failed ? (pending ? pending + ' Sync failed. Try Sync now.' : 'Sync failed. Try Sync now.') : pending);
    $('sync-status').title = activeStore.error;
    $('sync-now').disabled = Boolean(activeStore.running || activeStore.status === 'Syncing…');
    if (event?.type === 'status' && activeStore.status === 'Synced') transferProgress();
  }

  const account = createAccountLifecycle({
    open: user => openStore(client, user.id),
    reset(user) {
      onSignOut();
      showAccountIdentity(user);
      $('study-app').hidden = $('migration-panel').hidden = true;
      $('auth-panel').hidden = Boolean(user);
      $('sign-out').hidden = $('sync-now').hidden = !user;
      $('account-settings').hidden = !user;
      $('account-settings').open = false;
      $('export').hidden = $('import').hidden = !user;
      $('export').disabled = $('import').disabled = !user;
      if (!user) {
        try { localStorage.removeItem('flashcards-last-account'); } catch { /* Optional offline preference. */ }
        showSyncIssue('');
      }
    },
    ready(store, user) {
      try { localStorage.setItem('flashcards-last-account', JSON.stringify({ id: user.id })); }
      catch { /* Optional offline preference. */ }
      store.addEventListener('change', () => {
        if (account.store === store) {
          onLibrary(store.library);
          status();
        }
      });
      store.addEventListener('status', event => { if (account.store === store) status(event); });
      $('study-app').hidden = false;
      onStore(store);
      if (online()) store.sync();
      else { store.status = 'Offline · saved on this device'; status(); }
    },
    failed(error) {
      showAccountIdentity(null);
      $('study-app').hidden = true;
      $('auth-panel').hidden = false;
      $('sign-out').hidden = $('sync-now').hidden = $('export').hidden = $('import').hidden = true;
      $('account-settings').hidden = true;
      $('auth-message').textContent = 'Your local storage could not be opened. ' + error.message;
    }
  });

  async function switchAccount(user) {
    await account.switchTo(user);
    if (user?.email && account.store?.owner === user.id) showAccountIdentity(user);
  }

  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('send-signin').disabled = true;
    $('auth-message').textContent = 'Sending your sign-in link…';
    try {
      const redirect = new URL('./', location.href).href;
      const { error } = await client.auth.signInWithOtp({
        email: $('auth-email').value.trim(), options: { emailRedirectTo: redirect }
      });
      if (error) throw error;
      $('auth-message').textContent = 'Check your email and open the sign-in link on this device.';
    } catch (error) { $('auth-message').textContent = error.message; }
    finally { $('send-signin').disabled = false; }
  });

  $('sync-now').onclick = () => account.store?.sync();
  $('migration-replace').onclick = async () => {
    const activeStore = account.store;
    const library = stagedMigration();
    if (!library || !activeStore) return;
    if (!confirm('Replace the cloud library on all devices with the saved library from the original app? Export a backup first to keep both.')) return;
    try {
      const sourceHash = await migrationHash(library);
      if (account.store !== activeStore) return;
      await activeStore.importLibrary(library, { sourceHash });
      if (account.store !== activeStore) return;
      clearMigration();
      $('migration-panel').hidden = true;
    } catch (error) { showSyncIssue(error.message); }
  };
  addEventListener('flashcards-migration-ready', transferProgress);
  $('sign-out').onclick = async () => {
    const activeStore = account.store;
    if (activeStore?.pending.length) {
      await activeStore.sync();
      if (account.store !== activeStore) return;
      if (activeStore.pending.length) {
        showSyncIssue('Sync your pending changes before signing out.');
        return;
      }
    }
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) showSyncIssue(error.message);
  };
  addEventListener('pageshow', event => {
    if (event.persisted && online()) account.store?.sync();
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') switchAccount(null);
    else if (session?.user) switchAccount(session.user);
  });

  if (!online()) {
    try {
      const last = JSON.parse(localStorage.getItem('flashcards-last-account'));
      if (last?.id) await switchAccount(last);
    } catch { /* The sign-in panel remains available when no account is cached. */ }
  } else {
    const { data, error } = await client.auth.getSession();
    if (error) $('auth-message').textContent = error.message;
    await switchAccount(data?.session?.user ?? null);
  }

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      const update = $('update-app');
      function refreshUpdate() {
        update.hidden = !registration.waiting || !navigator.serviceWorker.controller;
      }
      const watch = () => registration.installing?.addEventListener('statechange', refreshUpdate);
      watch();
      registration.addEventListener('updatefound', watch);
      refreshUpdate();
      update.onclick = () => {
        if (!registration.waiting || !confirm('Reload to update the app? Saved grades stay on this device. The current round will restart.')) return;
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        registration.waiting.postMessage({ type: 'flashcards-activate-update' });
      };
    } catch { /* Browsers without offline caching can still study and sync. */ }
  }
  const version = import.meta.url.match(/app\.([a-f0-9]{16})\.js/)?.[1];
  if (version) $('app-build').textContent = 'Build ' + version.slice(0, 7);
}
