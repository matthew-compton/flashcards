import { createClient } from '@supabase/supabase-js';
import { StudyStore } from './storage.js';
import { createAccountLifecycle } from './account.js';
import { receiveMigration, stagedMigration, clearMigration, migrationHash } from './transfer.js';

const projectUrl = __SUPABASE_URL__;
const publicKey = __SUPABASE_PUBLISHABLE_KEY__;
const $ = id => document.getElementById(id);

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
      if (account.store === activeStore) $('sync-status').textContent = 'Migration pending · ' + error.message;
    } finally {
      if (migratingStore === activeStore) migratingStore = null;
    }
  }

  function status() {
    const activeStore = account.store;
    if (!activeStore) return;
    $('sync-status').textContent = activeStore.status;
    $('sync-status').title = activeStore.error;
    $('sync-now').disabled = Boolean(activeStore.running);
    if (activeStore.status === 'Synced') transferProgress();
  }

  const account = createAccountLifecycle({
    open: user => openStore(client, user.id),
    reset(user) {
      onSignOut();
      $('study-app').hidden = $('migration-panel').hidden = true;
      $('auth-panel').hidden = Boolean(user);
      $('sign-out').hidden = $('sync-now').hidden = !user;
      $('export').hidden = $('import').hidden = !user;
      $('sign-out').title = user?.email ? 'Signed in as ' + user.email : 'Sign out';
      $('export').disabled = $('import').disabled = !user;
      if (!user) {
        try { localStorage.removeItem('flashcards-last-account'); } catch { /* Optional offline preference. */ }
        $('sync-status').textContent = '';
      }
    },
    ready(store, user) {
      try { localStorage.setItem('flashcards-last-account', JSON.stringify({ id: user.id })); }
      catch { /* Optional offline preference. */ }
      store.addEventListener('change', () => {
        if (account.store === store) onLibrary(store.library);
      });
      store.addEventListener('status', () => { if (account.store === store) status(); });
      $('study-app').hidden = false;
      onStore(store);
      if (online()) store.sync();
      else { store.status = 'Offline · saved on this device'; status(); }
    },
    failed(error) {
      $('study-app').hidden = true;
      $('auth-panel').hidden = false;
      $('sign-out').hidden = $('sync-now').hidden = $('export').hidden = $('import').hidden = true;
      $('auth-message').textContent = 'Your local storage could not be opened. ' + error.message;
    }
  });

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
    } catch (error) { $('sync-status').textContent = error.message; }
  };
  addEventListener('flashcards-migration-ready', transferProgress);
  $('sign-out').onclick = async () => {
    const activeStore = account.store;
    if (activeStore?.pending.length) {
      await activeStore.sync();
      if (account.store !== activeStore) return;
      if (activeStore.pending.length) {
        $('sync-status').textContent = 'Sync your pending changes before signing out.';
        return;
      }
    }
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) $('sync-status').textContent = error.message;
  };
  addEventListener('online', () => account.store?.sync());
  addEventListener('offline', () => {
    const activeStore = account.store;
    if (activeStore) { activeStore.status = 'Offline · saved on this device'; status(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) account.store?.sync();
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') account.switchTo(null);
    else if (session?.user) account.switchTo(session.user);
  });

  if (!online()) {
    try {
      const last = JSON.parse(localStorage.getItem('flashcards-last-account'));
      if (last?.id) await account.switchTo(last);
    } catch { /* The sign-in panel remains available when no account is cached. */ }
  } else {
    const { data, error } = await client.auth.getSession();
    if (error) $('auth-message').textContent = error.message;
    await account.switchTo(data?.session?.user ?? null);
  }

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch { $('sync-status').title = 'Offline app caching is unavailable in this browser.'; }
  }
}
