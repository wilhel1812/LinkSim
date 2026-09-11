import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('tail retains first-invocation CPU correlation without raw request secrets',()=>{
  const dir=mkdtempSync(join(tmpdir(),'auth-tail-'));
  try {
    const event={eventTimestamp:123,cpuTime:2,wallTime:100,outcome:'ok',scriptVersion:{id:'version'},
      event:{request:{url:'https://probe.example/api/auth/get-session?code=PRIVATE',headers:{cookie:'PRIVATE'}},response:{status:200}},
      logs:[{message:[JSON.stringify({event:'probe-gateway-first-invocation',path:'/api/auth/get-session'})]}]};
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./summarize-tail.mjs',import.meta.url))],
      {cwd:dir,input:JSON.stringify(event,null,2)+'\n',encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const record=JSON.parse(result.stdout);
    assert.equal(record.firstInvocation,true);assert.equal(record.cpuMs,2);
    assert.equal(record.path,'/api/auth/get-session');assert.equal(record.version,'version');
    assert.equal(readFileSync(join(dir,'probe-tail.jsonl'),'utf8').includes('PRIVATE'),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
