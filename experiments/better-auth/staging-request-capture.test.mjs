import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('./staging-request-capture.js',import.meta.url),'utf8');
test('staging capture aggregates without retaining identifiers or query strings',()=>{
  let callback;let disconnected=false;let queued=[];
  const context={location:{origin:'https://staging.linksim.link'},URL,console:{info(){}},
    performance:{now:()=>1000,getEntriesByType:()=>[]},
    PerformanceObserver:class {constructor(cb){callback=cb;}observe(options){assert.deepEqual(options.type,'resource');assert.equal(options.buffered,true);}takeRecords(){const rows=queued;queued=[];return rows;}disconnect(){disconnected=true;}}};
  runInNewContext(code,context);
  const entry=(name,status=200)=>({name,initiatorType:'fetch',responseStatus:status});
  callback({getEntries:()=>[entry('/api/library?token=PRIVATE'),entry('/api/avatar/PRIVATE'),
    entry('/api/PRIVATE/secret'),entry('https://github.com/api/PRIVATE'),entry('/client.js'),entry('/api/library',0)]});
  queued=[entry('/api/library')];
  const result=JSON.parse(JSON.stringify(context.linkSimRequestCapture.stop()));
  assert.equal(disconnected,true);assert.equal(result.stopped,true);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.equal(result.requests.find(r=>r.route==='/api/library'&&r.status===200).count,2);
  assert.equal(result.requests.find(r=>r.status==='unknown').count,1);
  assert.equal(result.requests.reduce((n,r)=>n+r.count,0),5);
  assert.deepEqual(JSON.parse(JSON.stringify(context.linkSimRequestCapture.summary())).requests,result.requests);
  assert.throws(()=>runInNewContext(code,context),/already installed/);
});
test('capture refuses production before inspecting browser resources',()=>{
  assert.throws(()=>runInNewContext(code,{location:{origin:'https://linksim.link'}}),/Stable staging only/);
});
