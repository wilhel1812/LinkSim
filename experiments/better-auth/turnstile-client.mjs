import { turnstileAction } from './turnstile-policy.mjs';

let loading;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('Anti-bot check could not load. Try again.')); }, 15000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => {
        if (!window.turnstile) { clearTimeout(timer); return reject(new Error('Anti-bot check unavailable.')); }
        window.turnstile.ready(() => { clearTimeout(timer); resolve(window.turnstile); });
      };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Anti-bot check could not load. Try again.')); };
      document.head.append(script);
    }).catch(error => { loading = undefined; throw error; });
  }
  return loading;
}

export async function getTurnstileToken(container, { load = loadTurnstile, timeoutMs = 120000 } = {}) {
  const sitekey = container.dataset.sitekey;
  if (!sitekey) return 'XXXX.DUMMY.TOKEN.XXXX'; // Explicit fixture page only.
  const api = await load();
  container.replaceChildren();
  let widget;
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Anti-bot check timed out. Try again.')), timeoutMs);
      widget = api.render(container, { sitekey, action: turnstileAction,
        callback: token => token ? resolve(token) : reject(new Error('Anti-bot check returned no token.')),
        'error-callback': () => { reject(new Error('Anti-bot check failed. Try again.')); return true; },
        'expired-callback': () => reject(new Error('Anti-bot check expired. Try again.')),
        'timeout-callback': () => reject(new Error('Anti-bot check timed out. Try again.')),
      });
    });
  } finally {
    clearTimeout(timer);
    if (widget !== undefined) api.remove(widget);
  }
}
