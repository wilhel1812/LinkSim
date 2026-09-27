// Paste into the stable staging page's browser console; no network calls or persistence.
(() => {
  if (location.origin !== 'https://staging.linksim.link') throw new Error('Stable staging only');
  if (globalThis.linkSimRequestCapture) throw new Error('Capture already installed; reload to start a new page session');
  const routes = new Set(['me','library','site-notice','notifications','users','deleted-users',
    'admin-audit','auth-diagnostics','schema-diagnostics','admin-site-notice','stats',
    'calculate','jobs','v1','avatar','avatar-upload','auth']);
  const counts = new Map();
  const started = performance.now();
  const initialBufferSize = performance.getEntriesByType('resource').length;
  let stopped = false;
  let ended;
  const add = entries => {
    for (const entry of entries) {
      if (!['fetch','xmlhttprequest'].includes(entry.initiatorType)) continue;
      const url = new URL(entry.name, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) continue;
      const part = url.pathname.split('/')[2];
      const route = routes.has(part) ? `/api/${part}` : '/api/[other]';
      const status = Number.isInteger(entry.responseStatus) && entry.responseStatus >= 100 && entry.responseStatus <= 599
        ? entry.responseStatus : 'unknown';
      const key = `${route} ${status}`;
      const row = counts.get(key) ?? {route,status,count:0};
      row.count++;
      counts.set(key,row);
    }
  };
  const observer = new PerformanceObserver(list => add(list.getEntries()));
  observer.observe({type:'resource',buffered:true});
  const summary = () => {
    add(observer.takeRecords());
    return {
      source:'staging resource timing; completed requests only',
      pageAgeSeconds:Math.round((ended ?? performance.now())/1000),
      captureSeconds:Math.round(((ended ?? performance.now())-started)/1000),
      initialBufferSize,
      coverage:'May omit failed or earlier evicted entries; reload resets capture. Methods and D1 costs unavailable.',
      stopped,
      requests:[...counts.values()].sort((a,b)=>a.route.localeCompare(b.route)||String(a.status).localeCompare(String(b.status))),
    };
  };
  globalThis.linkSimRequestCapture = Object.freeze({summary,stop(){add(observer.takeRecords());observer.disconnect();ended ??= performance.now();stopped=true;return summary();}});
  console.info('Staging capture installed. After normal use, run JSON.stringify(linkSimRequestCapture.stop(), null, 2).');
})();
