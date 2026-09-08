import { appendFileSync } from 'node:fs';

// Wrangler emits pretty-printed JSON objects. Keep sensitive request headers
// only in memory; persist and display only the explicitly selected cost fields.
let buffer = '';
for await (const chunk of process.stdin) {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n}\n')) !== -1) {
    const start = buffer.indexOf('{');
    const candidate = buffer.slice(start, end + 2);
    buffer = buffer.slice(end + 3);
    const event = JSON.parse(candidate);
    const url = event.event?.request?.url;
    if (!url) continue;
    const record = {
      timestamp: event.eventTimestamp,
      path: new URL(url).pathname,
      status: event.event?.response?.status,
      cpuMs: event.cpuTime,
      wallMs: event.wallTime,
      outcome: event.outcome,
      version: event.scriptVersion?.id,
    };
    const line = JSON.stringify(record) + '\n';
    appendFileSync('probe-tail.jsonl', line);
    process.stdout.write(line);
  }
  if (buffer.length > 1_000_000) throw new Error('Unexpected tail framing; refusing to print raw data');
}
