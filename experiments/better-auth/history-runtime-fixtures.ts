import { LIBRARY_BATCH_MAX_RECORDS, LIBRARY_REQUEST_MAX_BYTES, LIBRARY_SIMULATION_MAX_BYTES, validateLibraryPayload } from '../../src/lib/libraryLimits';

export type HistoryScenario = 'small' | 'large' | 'max-record' | 'max-batch';
export type HistoryEntropy = 'repetitive' | 'varied';
export const historyRuntimeFixture = (scenario: HistoryScenario, entropy: HistoryEntropy): string => {
  const count = scenario === 'max-batch' ? LIBRARY_BATCH_MAX_RECORDS : 1;
  const target = scenario === 'small' ? 4096 : scenario === 'large' ? 64 * 1024 :
    scenario === 'max-record' ? LIBRARY_SIMULATION_MAX_BYTES : Math.floor((LIBRARY_REQUEST_MAX_BYTES - 256) / count);
  // Deterministic data generation is client-side, outside the CPU measurement.
  let seed = 1107;
  const padding = (size: number) => {
    if (entropy === 'repetitive') return 'synthetic'.repeat(Math.ceil(size / 9)).slice(0, size);
    let text = '';
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < size; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; text += alphabet[(seed >>> 0) % alphabet.length]; }
    return text;
  };
  const simulationPresets = Array.from({ length: count }, (_, index) => {
    const record = { id: `synthetic-${index}`, name: `Synthetic ${index}`, visibility: 'private', sharedWith: [], updatedAt: '2026-09-17T00:00:00.000Z', snapshot: {
      sites: [], links: [], systems: [], networks: [], syntheticPadding: '',
    }};
    record.snapshot.syntheticPadding = padding(target - new TextEncoder().encode(JSON.stringify(record)).length);
    return record;
  });
  const payload = { siteLibrary: [], simulationPresets };
  validateLibraryPayload(payload);
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).length > LIBRARY_REQUEST_MAX_BYTES) throw new Error('Fixture exceeds request budget');
  return serialized;
};
