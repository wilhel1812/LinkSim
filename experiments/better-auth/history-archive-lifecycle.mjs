import assert from 'node:assert/strict';

export function finishArchiveRun(results, expectedCount, persist) {
  persist(results); // Evidence survives the failure exit, including partial runs.
  assert.equal(results.length, expectedCount, 'Incomplete archive measurement run');
  assert.ok(results.every(result => result.status === 200 && !result.outcome), 'Archive measurement requests failed; inspect retained results');
}
export async function resumeArchiveSetup(operations) {
  let id = operations.databaseId();
  if (!id) {
    id = await operations.createDatabase();
    operations.saveDatabaseId(id); // Journal before another remote mutation.
  }
  await operations.verifyDatabase(id);
  if (!await operations.bucketExists()) await operations.createBucket();
}
export async function teardownArchiveProbe(operations) {
  // Recreate/renew the narrowly scoped cleanup capability even if initial deploy
  // never finished or the old probe expired. Do not reactivate application code.
  await operations.prepareCleanup();
  await operations.cleanup();
  await operations.deleteBucket();
  await operations.deleteWorker();
  await operations.deleteDatabase();
  operations.removeKey();
}
export function bucketInfoResult(result) {
  if (result.status === 0) return true;
  if (result.status === 1 && /\[code: 10006\]/.test(result.stderr ?? '')) return false;
  throw Error('Bucket lookup failed; do not treat authorization/network errors as absence');
}
