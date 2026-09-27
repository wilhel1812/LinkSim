// Request-local counters. Missing D1 metadata fails closed instead of
// reporting an invented zero. Wrapped bindings never escape one maintenance run.
export function meterArchiveBindings(DB: D1Database, BUCKET: R2Bucket) {
  const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0, r2Puts: 0, r2Gets: 0, r2Lists: 0 };
  const statement = (stmt: D1PreparedStatement): D1PreparedStatement => new Proxy(stmt, { get(target, key) {
    if (key === 'bind') return (...args: unknown[]) => statement(target.bind(...args));
    if (key === 'first') return async () => { const result = await statement(target).all(); return result.results[0] ?? null; };
    if (key === 'all' || key === 'run') return async () => {
      const result = await target[key]();
      if (!Number.isFinite(result.meta?.rows_read) || !Number.isFinite(result.meta?.rows_written)) throw Error('Missing D1 metrics');
      metrics.queries++; metrics.rowsRead += result.meta.rows_read; metrics.rowsWritten += result.meta.rows_written;
      return result;
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const meteredDB = new Proxy(DB, { get(target, key) {
    if (key === 'prepare') return (sql: string) => statement(target.prepare(sql));
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const meteredBucket = new Proxy(BUCKET, { get(target, key) {
    if (key === 'put') return (...args: Parameters<R2Bucket['put']>) => { metrics.r2Puts++; return target.put(...args); };
    if (key === 'get') return (...args: Parameters<R2Bucket['get']>) => { metrics.r2Gets++; return target.get(...args); };
    if (key === 'list') return (...args: Parameters<R2Bucket['list']>) => { metrics.r2Lists++; return target.list(...args); };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { DB: meteredDB, BUCKET: meteredBucket, metrics };
}
