import { prepareLibrary } from './model.js';

const STAGED = 'flashcards-pending-migration';

export function receiveMigration() {
  const match = location.hash.match(/^#transfer=([a-f0-9]{64})$/);
  if (!match || !window.opener) return;
  const nonce = match[1];
  const source = window.opener;
  history.replaceState(null, '', location.pathname + location.search);
  const receive = event => {
    if (event.source !== source || event.data?.type !== 'flashcards.library' || event.data.nonce !== nonce) return;
    try {
      const library = prepareLibrary(event.data.library);
      localStorage.setItem(STAGED, JSON.stringify(library));
      source.postMessage({ type: 'flashcards.received', nonce }, '*');
      window.removeEventListener('message', receive);
      document.getElementById('auth-message').textContent = 'Your existing library is ready. Sign in to transfer it to your account.';
      window.dispatchEvent(new Event('flashcards-migration-ready'));
    } catch {
      document.getElementById('auth-message').textContent = 'The original library could not be transferred. Its Export backup option is also available.';
    }
  };
  window.addEventListener('message', receive);
  source.postMessage({ type: 'flashcards.request-library', nonce }, '*');
}

export function stagedMigration() {
  const value = localStorage.getItem(STAGED);
  return value ? JSON.parse(value) : null;
}

export function clearMigration() {
  localStorage.removeItem(STAGED);
}

export async function migrationHash(library) {
  const bytes = new TextEncoder().encode(JSON.stringify(library));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
