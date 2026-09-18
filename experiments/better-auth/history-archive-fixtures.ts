import {historyRuntimeFixture} from './history-runtime-fixtures';
export const archiveFixtureRows=(scenario:Parameters<typeof historyRuntimeFixture>[0],entropy:Parameters<typeof historyRuntimeFixture>[1])=>{
  const payload=JSON.parse(historyRuntimeFixture(scenario,entropy));
  return payload.simulationPresets.map((record:Record<string, any>,i:number)=>{
    const before=JSON.stringify(record).length;
    record.ownerUserId='synthetic-owner';
    record.snapshot.syntheticPadding=record.snapshot.syntheticPadding.slice(JSON.stringify(record).length-before);
    return {id:i+1,snapshot_json:JSON.stringify(record),details_json:JSON.stringify({changedFields:['snapshot'],diff:{snapshot:{before:{...record.snapshot,previousRevision:true},after:record.snapshot}}})};
  });
};
export const archiveFixtureSchema='CREATE TABLE resource_changes(id INTEGER PRIMARY KEY,snapshot_json TEXT,details_json TEXT,archive_key TEXT,archive_digest TEXT)';
