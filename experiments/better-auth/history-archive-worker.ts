import { archiveHistoryPage, hydrateHistoryRow, restoreHistoryRow } from './history-archive';
import { meterArchiveBindings } from './history-archive-metrics';
type Env={ DB:D1Database; BUCKET:R2Bucket; PROBE_KEY?:string; PROBE_ENABLED?:string; PROBE_EXPIRES_AT?:string };
export async function handleArchiveProbe(request:Request,env:Env) {
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
  const { DB, BUCKET, metrics } = meterArchiveBindings(env.DB, env.BUCKET);
  const probe={DB,BUCKET,scope:'synthetic-staging'};
  let result;
  if(url.pathname==='/archive')result=await archiveHistoryPage(probe,{afterId:id-1,limit:10,apply:true});
  else if(url.pathname==='/restore')result={restored:await restoreHistoryRow(probe,id)};
  else {const row=await hydrateHistoryRow(probe,id);result={found:!!row,bytes:new TextEncoder().encode((row?.snapshot_json??'')+(row?.details_json??'')).length};}
  return Response.json({result,metrics},{headers:{'cache-control':'no-store'}});
}
export default {fetch:handleArchiveProbe};
