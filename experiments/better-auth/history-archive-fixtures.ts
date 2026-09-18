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

// Synthetic audience mix for the indexed local probe. The 37/99 currently
// public or shared fraction is close to the 796/2155 candidate count in a
// read-only staging aggregate on 2026-09-18. Record sizes are deliberately
// large stress inputs, not a measured staging size distribution. The deleted
// Site exercises the tombstone index but is too small to archive.
export const archiveMixedFixtureRows=()=>{
  const base=archiveFixtureRows('large','varied')[0];
  return Array.from({length:100},(_,index)=>{
    const id=index+1;
    if(id===100)return {id,resource_kind:'site',resource_id:'synthetic-site',note:'Deleted Site',
      snapshot_json:JSON.stringify({id:'synthetic-site',name:'Synthetic Site',ownerUserId:'synthetic-owner',visibility:'public',sharedWith:[],lat:78.6,lon:16.3}),
      details_json:null};
    const snapshot=JSON.parse(base.snapshot_json);
    const details=JSON.parse(base.details_json);
    snapshot.id=`synthetic-${id}`;
    snapshot.visibility=id<=37?(id%3===0?'shared':'public'):'private';
    snapshot.sharedWith=snapshot.visibility==='shared'?[{userId:'synthetic-reader',role:'viewer'}]:[];
    if(id===38){
      details.changedFields=[...new Set([...details.changedFields,'visibility'])];
      details.diff.visibility={before:'public',after:'private'};
    }
    return {id,resource_kind:'simulation',resource_id:`synthetic-${id}`,note:null,
      snapshot_json:JSON.stringify(snapshot),details_json:JSON.stringify(details)};
  });
};
