import { archiveHistoryPage, hydrateHistoryRow, restoreHistoryRow } from './history-archive';
type Env={ DB:D1Database; BUCKET:R2Bucket; PROBE_KEY?:string; PROBE_ENABLED?:string; PROBE_EXPIRES_AT?:string };
export default {async fetch(request:Request,env:Env){
  const expiry=Date.parse(env.PROBE_EXPIRES_AT??'');
  if(env.PROBE_ENABLED!=='synthetic-history-r2'||!env.PROBE_KEY||!Number.isFinite(expiry)||expiry<=Date.now()||
      request.headers.get('authorization')!==`Bearer ${env.PROBE_KEY}`)return new Response(null,{status:404});
  const url=new URL(request.url);
  if(request.method==='POST'&&url.pathname==='/cleanup'){
    // Disposable bucket only; never expose this worker with application bindings.
    for(let page=0;page<10;page++){const listed=await env.BUCKET.list({prefix:'history-prototype/synthetic-staging/',limit:100});
      if(!listed.objects.length)return Response.json({clean:true});
      await env.BUCKET.delete(listed.objects.map(item=>item.key));}
    return new Response(null,{status:409});
  }
  const id=Number(url.searchParams.get('id')??1);
  if(request.method!=='POST'||!['/archive','/hydrate','/restore'].includes(url.pathname)||!Number.isSafeInteger(id)||id<1)return new Response(null,{status:404});
  // Request-local counters, following the existing auth probe. Missing metadata
  // fails the experiment rather than silently reporting zero cost.
  const metrics={queries:0,rowsRead:0,rowsWritten:0,r2Puts:0,r2Gets:0};
  const statement=(stmt:D1PreparedStatement):D1PreparedStatement=>new Proxy(stmt,{get(target,key){
    if(key==='bind')return(...args:unknown[])=>statement(target.bind(...args));
    if(key==='first')return async()=>{const result=await statement(target).all();return result.results[0]??null;};
    if(key==='all'||key==='run')return async()=>{const result=await target[key]();
      if(!Number.isFinite(result.meta?.rows_read)||!Number.isFinite(result.meta?.rows_written))throw Error('Missing D1 metrics');
      metrics.queries++;metrics.rowsRead+=result.meta.rows_read;metrics.rowsWritten+=result.meta.rows_written;return result;};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>statement(target.prepare(sql));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const BUCKET=new Proxy(env.BUCKET,{get(target,key){
    if(key==='put')return(...args:Parameters<R2Bucket['put']>)=>{metrics.r2Puts++;return target.put(...args);};
    if(key==='get')return(...args:Parameters<R2Bucket['get']>)=>{metrics.r2Gets++;return target.get(...args);};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const probe={DB,BUCKET,scope:'synthetic-staging'};
  let result;
  if(url.pathname==='/archive')result=await archiveHistoryPage(probe,{afterId:id-1,limit:10,apply:true});
  else if(url.pathname==='/restore')result={restored:await restoreHistoryRow(probe,id)};
  else {const row=await hydrateHistoryRow(probe,id);result={found:!!row,bytes:new TextEncoder().encode((row?.snapshot_json??'')+(row?.details_json??'')).length};}
  return Response.json({result,metrics},{headers:{'cache-control':'no-store'}});
}};
