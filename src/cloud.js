import { createClient } from '@supabase/supabase-js';
import { StudyStore } from './storage.js';
import { receiveMigration, stagedMigration, clearMigration, migrationHash } from './transfer.js';

const projectUrl = __SUPABASE_URL__;
const publicKey = __SUPABASE_PUBLISHABLE_KEY__;
const $ = id => document.getElementById(id);

export async function startCloud({ onStore, onLibrary, onSignOut }) {
  receiveMigration();
  if (!projectUrl || !publicKey) {
    $('auth-message').textContent = 'The cloud connection has not been configured for this build.';
    $('send-signin').disabled = true;
    return;
  }
  const client = createClient(projectUrl, publicKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  let activeStore;
  let activeOwner;
  let opening = Promise.resolve();
  let migrating = false;

  async function transferProgress() {
    if (!activeStore || migrating || activeStore.status !== 'Synced') return;
    const library = stagedMigration();
    if (!library) return;
    migrating = true;
    try {
      const sourceHash = await migrationHash(library);
      const migrated = activeStore.records.some(record => record.event.payload?.sourceHash === sourceHash);
      if (migrated) { clearMigration(); return; }
      if (activeStore.generation) {
        $('migration-panel').hidden = false;
        return;
      }
      await activeStore.importLibrary(library, { sourceHash });
      clearMigration();
      $('migration-panel').hidden = true;
    } catch (error) { $('sync-status').textContent = 'Migration pending · ' + error.message; }
    finally { migrating = false; }
  }

  function status() {
    if (!activeStore) return;
    $('sync-status').textContent = activeStore.status;
    $('sync-status').title = activeStore.error;
    $('sync-now').disabled = Boolean(activeStore.running);
    if (activeStore.status === 'Synced') transferProgress();
  }

  async function openAccount(user) {
    if (user?.id === activeOwner) return;
    activeStore?.close();
    activeStore = null;
    activeOwner = user?.id;
    onSignOut();
    $('study-app').hidden = true;
    $('auth-panel').hidden = Boolean(user);
    $('sign-out').hidden = $('sync-now').hidden = !user;
    $('export').disabled = $('import').disabled = !user;
    if (!user) {
      localStorage.removeItem('flashcards-last-account');
      $('sync-status').textContent = '';
      return;
    }
    try {
      const store = await new StudyStore(client, user.id).open();
      activeStore = store;
      localStorage.setItem('flashcards-last-account', JSON.stringify({ id: user.id }));
      store.addEventListener('change', () => {
        if (activeStore === store) onLibrary(store.library);
      });
      store.addEventListener('status', status);
      $('study-app').hidden = false;
      onStore(store);
      if (navigator.onLine) await store.sync();
      else { store.status = 'Offline · saved on this device'; status(); }
    } catch (error) {
      activeOwner = null;
      $('auth-panel').hidden = false;
      $('auth-message').textContent = 'Your local storage could not be opened. ' + error.message;
    }
  }

  function queueAccount(user) {
    opening = opening.then(() => openAccount(user));
    return opening;
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

  $('sync-now').onclick = () => activeStore?.sync();
  $('migration-replace').onclick = async () => {
    const library = stagedMigration();
    if (!library || !activeStore) return;
    if (!confirm('Replace the cloud library on all devices with the saved library from the original app? Export a backup first to keep both.')) return;
    try {
      await activeStore.importLibrary(library, { sourceHash: await migrationHash(library) });
      clearMigration();
      $('migration-panel').hidden = true;
    } catch (error) { $('sync-status').textContent = error.message; }
  };
  addEventListener('flashcards-migration-ready', transferProgress);
  $('sign-out').onclick = async () => {
    if (activeStore?.pending.length) {
      await activeStore.sync();
      if (activeStore.pending.length) {
        $('sync-status').textContent = 'Sync your pending changes before signing out.';
        return;
      }
    }
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) $('sync-status').textContent = error.message;
  };
  addEventListener('online', () => activeStore?.sync());
  addEventListener('offline', () => {
    if (activeStore) { activeStore.status = 'Offline · saved on this device'; status(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activeStore?.sync();
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') queueAccount(null);
    else if (session?.user) queueAccount(session.user);
  });

  if (!navigator.onLine) {
    try {
      const last = JSON.parse(localStorage.getItem('flashcards-last-account'));
      if (last?.id) await queueAccount(last);
    } catch { /* The sign-in panel remains available when no account is cached. */ }
  } else {
    const { data, error } = await client.auth.getSession();
    if (error) $('auth-message').textContent = error.message;
    await queueAccount(data?.session?.user ?? null);
  }

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch { $('sync-status').title = 'Offline app caching is unavailable in this browser.'; }
  }
}
