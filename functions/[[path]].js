function json(data, status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*"}})}
export async function onRequest(context){
 const {request,env}=context; const url=new URL(request.url);
 if(request.method==="OPTIONS")return new Response(null,{headers:{"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type"}});
 if(!env.DB)return json({ok:false,error:"D1 binding DB is missing"},500);
 if(url.pathname==="/api/health")return json({ok:true,database:"connected"});
 if(url.pathname==="/api/leaderboard"){
  const {results=[]}=await env.DB.prepare("SELECT name, level FROM players ORDER BY level DESC, updated_at ASC LIMIT 20").all();
  return json({ok:true,players:results});
 }
 if(url.pathname==="/api/progress" && request.method==="POST"){
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const telegram_id=String(body.telegram_id||"").slice(0,64),name=String(body.name||"Player").slice(0,80);
  const level=Math.max(1,Math.min(10000,Number(body.level)||1));
  if(!telegram_id)return json({ok:false,error:"telegram_id is required"},400);
  await env.DB.prepare(`INSERT INTO players (telegram_id,name,level,completed,updated_at) VALUES (?1,?2,?3,?4,datetime('now')) ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name,level=MAX(players.level,excluded.level),completed=MAX(players.completed,excluded.completed),updated_at=datetime('now')`).bind(telegram_id,name,level,Number(body.completed)||0).run();
  await env.DB.prepare("INSERT INTO score_history (telegram_id,level,created_at) VALUES (?1,?2,datetime('now'))").bind(telegram_id,level).run();
  return json({ok:true});
 }
 return json({ok:false,error:"Not found"},404);
}