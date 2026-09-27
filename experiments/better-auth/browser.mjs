import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { getUiErrorMessage } from '../../src/lib/uiError.ts';
import { getTurnstileToken } from './turnstile-client.mjs';

const auth = createAuthClient({ baseURL: location.origin, plugins: [passkeyClient()],
  fetchOptions: { timeout: 20000, retry: 0 } });
const status = document.querySelector('#status');
const list = document.querySelector('#passkeys');
const result = document.querySelector('#results');
function checked(response) {
  if (response.error) throw new Error(response.error.message || 'Authentication request failed');
  return response.data;
}
async function refresh() {
  const session = checked(await auth.getSession());
  const signedIn = !!session;
  status.textContent = signedIn ? `Signed in. Provider email verified: ${session.user.emailVerified ? 'yes' : 'no'}.` : 'Signed out.';
  for (const id of ['add', 'logout', 'measure']) document.getElementById(id).disabled = !signedIn;
  document.getElementById('github').disabled = signedIn;
  document.getElementById('passkey').disabled = signedIn;
  list.replaceChildren();
  if (signedIn) {
    const passkeys = checked(await auth.passkey.listUserPasskeys());
    for (const key of passkeys ?? []) {
      const item = document.createElement('li');
      const label = key.name || 'Test passkey';
      item.append(document.createTextNode(`${label} `));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = `Remove ${label}`;
      remove.addEventListener('click', () => perform(async () => checked(await auth.passkey.deletePasskey({ id: key.id }))));
      item.append(remove);
      list.append(item);
    }
  }
}
let busy = false;
async function perform(action, refreshAfter = true) {
  if (busy) return;
  busy = true;
  status.textContent = 'Working…';
  try { await action(); if (refreshAfter) await refresh(); }
  catch (error) { status.textContent = getUiErrorMessage(error); }
  finally { busy = false; }
}
document.getElementById('github').addEventListener('click', () => perform(async () => {
  const token = await getTurnstileToken(document.getElementById('captcha'));
  checked(await auth.signIn.social({ provider: 'github', callbackURL: '/', errorCallbackURL: '/' },
    { headers: { 'x-captcha-response': token } }));
}, false));
document.getElementById('passkey').addEventListener('click', () => perform(async () => checked(await auth.signIn.passkey())));
document.getElementById('add').addEventListener('click', () => perform(async () => checked(await auth.passkey.addPasskey({ name: 'LinkSim validation' }))));
document.getElementById('logout').addEventListener('click', () => perform(async () => checked(await auth.signOut())));
document.getElementById('measure').addEventListener('click', () => perform(async () => {
  const rows = [];
  for (const path of ['/api/auth/get-session', '/probe/session/reused', '/probe/session/fresh']) {
    for (let sample = 1; sample <= 3; sample++) {
      const start = performance.now();
      const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      await response.arrayBuffer(); // Consume without displaying cookies, profiles or session tokens.
      rows.push({ path, sample, status: response.status, elapsedMs: Math.round(performance.now() - start),
        objectElapsedMs: JSON.parse(response.headers.get('x-probe-object-elapsed-ms') ?? 'null'),
        d1: JSON.parse(response.headers.get('x-probe-d1') ?? 'null') });
      if (!response.ok) throw new Error(`Session measurement stopped: HTTP ${response.status}`);
    }
  }
  const concurrent = await Promise.all(Array.from({ length: 50 }, async (_, sample) => {
    const start = performance.now();
    const response = await fetch('/probe/session/reused', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`Concurrent session measurement stopped: HTTP ${response.status}`);
    return { path: '/probe/session/reused', concurrent: true, sample: sample + 1, status: response.status,
      elapsedMs: Math.round(performance.now() - start), objectElapsedMs: JSON.parse(response.headers.get('x-probe-object-elapsed-ms') ?? 'null'),
        d1: JSON.parse(response.headers.get('x-probe-d1') ?? 'null') };
  }));
  rows.push(...concurrent);
  result.textContent = JSON.stringify(rows, null, 2);
}));
const callbackError = new URL(location.href).searchParams.has('error');
history.replaceState(null, '', '/');
refresh().then(() => {
  if (callbackError) status.textContent = 'GitHub sign-in failed. Tell the maintainer so the callback can be checked.';
}).catch(error => { status.textContent = getUiErrorMessage(error); });
