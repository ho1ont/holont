import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const BASE=process.env.PRIME_URL||'https://prime-online-v01.vercel.app/';
const SB='https://lqnnqsopdqnibbyzoakc.supabase.co';
const AUTH=`${SB}/functions/v1/prime-auth`,CONNECT=`${SB}/functions/v1/prime-connect`,CALL=`${SB}/functions/v1/prime-call`,START=`${SB}/functions/v1/prime-call-start`,CLEAN=`${SB}/functions/v1/prime-qa-cleanup`;
const RUN=String(process.env.GITHUB_RUN_ID||Date.now());
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'x';
const add=(a,severity,code,title,meaning,detail={})=>a.push({severity,code,title,meaning,detail});
const post=(request,url,t,data)=>request.post(url,{headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},data,timeout:20000});
const get=(request,url,t)=>request.get(url,{headers:{Authorization:`Bearer ${t}`},timeout:20000});

async function signup(request,project,suffix){
  const tag=`${String(RUN).slice(-8)}${suffix}${slug(project).replace(/-/g,'').slice(0,8)}`.slice(0,18);
  const q={email:`qa4-${tag}@prime.invalid`,password:`PrimeCall4-${tag}-X9!`,handle:`qa4_${tag}`.slice(0,32),display_name:`QA 4.0 ${suffix.toUpperCase()} ${project}`.slice(0,32)};
  const r=await request.post(AUTH,{data:{action:'signup',...q},timeout:15000}),d=await r.json().catch(()=>({}));
  if(!r.ok()||!d?.token)throw new Error(`signup ${suffix} ${r.status()} ${JSON.stringify(d).slice(0,260)}`);
  return {...q,token:d.token};
}
async function pair(request,project){
  const a=await signup(request,project,'a'),b=await signup(request,project,'b');
  let r=await post(request,CONNECT,a.token,{action:'create_invite'}),d=await r.json().catch(()=>({}));
  if(!r.ok()||!d?.code)throw new Error(`invite ${r.status()} ${JSON.stringify(d)}`);
  r=await post(request,CONNECT,b.token,{action:'accept',code:d.code});d=await r.json().catch(()=>({}));
  if(!r.ok()||!d?.ok)throw new Error(`accept ${r.status()} ${JSON.stringify(d)}`);
  return {a,b};
}
async function cleanup(request,pair,callIds=[]){
  if(!pair)return;
  for(const id of callIds.filter(Boolean)){
    await post(request,CALL,pair.a.token,{action:'end',call_id:id,reason:'qa_cleanup'}).catch(()=>null);
    await post(request,CALL,pair.b.token,{action:'end',call_id:id,reason:'qa_cleanup'}).catch(()=>null);
  }
  for(const q of [pair.a,pair.b])await request.post(CLEAN,{headers:{Authorization:`Bearer ${q.token}`},data:{},timeout:15000}).catch(()=>null);
}
async function dismiss(page){
  await page.evaluate(()=>{document.getElementById('releasegate')?.remove();document.getElementById('onboard')?.remove();document.querySelectorAll('.prime-guide').forEach(x=>x.remove())}).catch(()=>{});
}
async function loadApp(ctx,token){
  await ctx.grantPermissions(['camera','microphone','notifications'],{origin:new URL(BASE).origin}).catch(()=>{});
  const page=await ctx.newPage();
  await page.addInitScript(t=>localStorage.setItem('prime_token',t),token);
  await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForTimeout(650);await dismiss(page);
  await page.waitForFunction(()=>!!window.PRIME?.state?.token&&!!window.PRIME_R1114_VIDEO_CALL,null,{timeout:15000});
  await page.waitForFunction(()=>!!window.PRIME?.state?.mine,null,{timeout:15000});
  return page;
}
async function startUiCall(page,handle){
  await page.evaluate(h=>{const b=document.createElement('button');b.type='button';b.dataset.callStart=h;b.style.position='fixed';b.style.left='2px';b.style.top='2px';b.style.zIndex='99999';document.body.appendChild(b);b.click();b.remove()},handle);
}
async function state(page){
  return page.evaluate(()=>{const a=window.PRIME?.state?.videoCall||null,pc=a?.pc||null,root=document.getElementById('primecall'),banner=document.getElementById('primecallbanner');return {callId:a?.call?.id||null,status:a?.call?.status||null,role:a?.role||null,connected:!!a?.connected,pcState:pc?.connectionState||null,iceState:pc?.iceConnectionState||null,relay:!!a?._httpRelayActive,relaySeen:!!a?.relaySeen,localTracks:a?.local?.getTracks?.().map(t=>({kind:t.kind,readyState:t.readyState,enabled:t.enabled}))||[],remoteTracks:a?.remote?.getTracks?.().map(t=>({kind:t.kind,readyState:t.readyState,enabled:t.enabled}))||[],iceErrors:(a?.iceErrors||[]).slice(0,8),callStatus:document.getElementById('callstatus')?.textContent||'',quality:document.getElementById('callquality')?.textContent||'',rootVisible:!!root&&!root.classList.contains('hidden'),bannerVisible:!!banner&&!banner.classList.contains('hidden')}});
}
async function audit(page,label,issues,screens,project,who){
  const a=await page.evaluate(()=>{const root=document.querySelector('#primecall:not(.hidden),#primecallbanner:not(.hidden)'),vw=innerWidth,vh=innerHeight,covered=[],off=[];if(!root)return{visible:false,covered,off,overflow:0};const vis=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity||1)>.02&&r.width>0&&r.height>0};for(const e of [...root.querySelectorAll('button,[role="button"]')].filter(vis)){const r=e.getBoundingClientRect(),n=(e.getAttribute('aria-label')||e.textContent||e.className||'control').trim().replace(/\s+/g,' ').slice(0,80);if(r.left<-3||r.right>vw+3||r.top<-3||r.bottom>vh+3)off.push({name:n,left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom)});const x=Math.max(1,Math.min(vw-1,r.left+r.width/2)),y=Math.max(1,Math.min(vh-1,r.top+r.height/2)),t=document.elementFromPoint(x,y);if(t&&!(t===e||e.contains(t)||t.contains(e)))covered.push({name:n,coveredBy:(t.getAttribute?.('aria-label')||t.textContent||t.className||t.tagName).toString().trim().replace(/\s+/g,' ').slice(0,90)})}return{visible:true,covered,off,overflow:Math.max(0,root.scrollWidth-vw)}});
  fs.mkdirSync('artifacts/calls-screens',{recursive:true});const p=`artifacts/calls-screens/${slug(project)}-${who}-${slug(label)}.png`;await page.screenshot({path:p});screens.push({who,label,screenshot:p,audit:a});
  if(a.overflow>3)add(issues,'HIGH','CALL_HORIZONTAL_OVERFLOW',`${who}/${label}: overflow ${a.overflow}px`,'Экран звонка шире viewport iPhone.',a);
  if(a.covered.length)add(issues,'HIGH','CALL_COVERED_CONTROL',`${who}/${label}: перекрыты кнопки`,'Видимая кнопка звонка получает hit-test через другой слой.',{elements:a.covered.slice(0,8)});
  if(a.off.length)add(issues,'MEDIUM','CALL_OFFSCREEN_CONTROL',`${who}/${label}: элементы за экраном`,'Контрол звонка выходит за viewport.',{elements:a.off.slice(0,8)});
}
function save(project,r){
  fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync(`artifacts/calls-${project}.json`,JSON.stringify(r,null,2));
  const c=r.issues.reduce((a,x)=>(a[x.severity]=(a[x.severity]||0)+1,a),{}),o=[`# PRIME Calls Deep QA — ${project}`,'',`- Duration: ${r.duration_ms} ms`,`- API duplicate: ${r.api_duplicate_ok}`,`- API decline: ${r.api_decline_ok}`,`- API cancel: ${r.api_cancel_ok}`,`- ICE/TURN config: ${r.turn_config_ok}`,`- First call connected: ${r.first_connected}`,`- Second call connected after poll failures: ${r.second_connected}`,`- Issues: ${r.issues.length} (CRITICAL ${c.CRITICAL||0}, HIGH ${c.HIGH||0}, MEDIUM ${c.MEDIUM||0}, LOW ${c.LOW||0})`,'','## Bugs',''];
  if(!r.issues.length)o.push('Подтверждённых проблем не найдено.');r.issues.forEach((x,i)=>o.push(`### CALL-${String(i+1).padStart(3,'0')} · ${x.severity} · ${x.code}`,`**Баг:** ${x.title}`,`**Что это значит:** ${x.meaning}`,`**Детали:** \`${JSON.stringify(x.detail).slice(0,1800)}\``,''));fs.writeFileSync(`artifacts/calls-${project}.md`,o.join('\n'));
}

async function waitConnected(page,ms=35000){return page.waitForFunction(()=>!!window.PRIME?.state?.videoCall?.connected,null,{timeout:ms}).then(()=>true).catch(()=>false)}
async function waitReset(page,ms=12000){return page.waitForFunction(()=>{const a=window.PRIME?.state?.videoCall;const r=document.getElementById('primecall');return !a?.call?.id&&(!r||r.classList.contains('hidden'))},null,{timeout:ms}).then(()=>true).catch(()=>false)}

for(const project of ['iphone-15-pro','compact-iphone']){
  test(`PRIME Calls deep QA ${project}`,async({browser,request},info)=>{
    if(info.project.name!==project)test.skip();
    test.setTimeout(210000);
    const started=Date.now(),issues=[],screens=[],pageErrors=[],http5=[],requestFailures=[];let pairData=null,ctxA=null,ctxB=null,pageA=null,pageB=null;const callIds=[];let apiDuplicateOk=false,apiDeclineOk=false,apiCancelOk=false,turnConfigOk=false,firstConnected=false,secondConnected=false,simulatedPollFailures=0;
    try{
      pairData=await pair(request,project);
      let r=await get(request,`${CALL}?action=ice_config`,pairData.a.token),d=await r.json().catch(()=>({}));const urls=(d.ice_servers||[]).flatMap(x=>Array.isArray(x.urls)?x.urls:[x.urls]).filter(Boolean);turnConfigOk=r.ok()&&urls.some(x=>/^turns?:/i.test(String(x)))&&(d.ice_servers||[]).some(x=>x.username&&x.credential);if(!turnConfigOk)add(issues,'CRITICAL','TURN_CONFIG_INVALID','ICE/TURN конфигурация неполная','Без TURN удалённые пользователи могут навсегда остаться на «Соединяю».',{status:r.status(),urls});
      r=await post(request,START,pairData.a.token,{handle:pairData.b.handle,video:true});d=await r.json().catch(()=>({}));if(!r.ok()||!d?.call?.id)throw new Error(`api start ${r.status()} ${JSON.stringify(d).slice(0,300)}`);const apiCall1=d.call.id;callIds.push(apiCall1);
      const rDup=await post(request,START,pairData.a.token,{handle:pairData.b.handle,video:true}),dDup=await rDup.json().catch(()=>({}));apiDuplicateOk=rDup.ok()&&dDup?.duplicate===true&&dDup?.call?.id===apiCall1;if(!apiDuplicateOk)add(issues,'HIGH','DUPLICATE_CALL_CREATE','Повторный старт создал новое состояние вызова','Повторный быстрый tap должен возвращать тот же ringing call, а не создавать второй.',{first:apiCall1,second:dDup?.call?.id,duplicate:dDup?.duplicate,status:rDup.status()});
      const rWatch=await get(request,`${CALL}?action=watch`,pairData.b.token),dWatch=await rWatch.json().catch(()=>({}));if(dWatch?.incoming?.id!==apiCall1)add(issues,'HIGH','INCOMING_WATCH_MISSED','Получатель не увидел ringing call через watch','Backend входящих не возвращает только что созданный звонок.',{watch:dWatch});
      const rDecl=await post(request,CALL,pairData.b.token,{action:'decline',call_id:apiCall1}),dDecl=await rDecl.json().catch(()=>({}));apiDeclineOk=rDecl.ok()&&dDecl?.call?.status==='declined';if(!apiDeclineOk)add(issues,'HIGH','DECLINE_STATE_FAILED','Отклонение не перевело звонок в declined','После отказа звонок должен завершиться для обоих.',{status:rDecl.status(),body:dDecl});
      r=await post(request,START,pairData.a.token,{handle:pairData.b.handle,video:true});d=await r.json().catch(()=>({}));if(!r.ok()||!d?.call?.id)throw new Error(`api start2 ${r.status()} ${JSON.stringify(d).slice(0,300)}`);const apiCall2=d.call.id;callIds.push(apiCall2);const rCancel=await post(request,CALL,pairData.a.token,{action:'cancel',call_id:apiCall2}),dCancel=await rCancel.json().catch(()=>({}));apiCancelOk=rCancel.ok()&&dCancel?.call?.status==='cancelled';if(!apiCancelOk)add(issues,'HIGH','CANCEL_STATE_FAILED','Caller cancel не перевёл звонок в cancelled','Отмена до принятия должна сразу завершить ringing call.',{status:rCancel.status(),body:dCancel});

      const v=project==='compact-iphone'?{width:375,height:667,dpr:2}:{width:393,height:852,dpr:3};const opts={viewport:{width:v.width,height:v.height},deviceScaleFactor:v.dpr,isMobile:true,hasTouch:true};ctxA=await browser.newContext(opts);ctxB=await browser.newContext(opts);pageA=await loadApp(ctxA,pairData.a.token);pageB=await loadApp(ctxB,pairData.b.token);
      for(const [page,who] of [[pageA,'A'],[pageB,'B']]){page.on('pageerror',e=>pageErrors.push({who,error:String(e?.message||e).slice(0,1200)}));page.on('response',x=>{if(x.status()>=500)http5.push({who,status:x.status(),url:x.url()})});page.on('requestfailed',x=>{if(!x.url().includes('action=poll')||simulatedPollFailures===0)requestFailures.push({who,url:x.url(),error:x.failure()?.errorText})})}
      const mediaProbe=await pageA.evaluate(async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true,video:true});const out=s.getTracks().map(t=>({kind:t.kind,state:t.readyState}));s.getTracks().forEach(t=>t.stop());return out}catch(e){return{error:String(e?.name||e?.message||e)}}});if(!Array.isArray(mediaProbe)||!mediaProbe.some(x=>x.kind==='audio')||!mediaProbe.some(x=>x.kind==='video'))add(issues,'CRITICAL','FAKE_MEDIA_UNAVAILABLE','QA browser не получил камеру/микрофон','Без media tracks browser-run не может проверять настоящий WebRTC lifecycle.',{mediaProbe});

      await startUiCall(pageA,pairData.b.handle);await pageA.waitForFunction(()=>window.PRIME?.state?.videoCall?.call?.status==='ringing',null,{timeout:18000});const firstId=await pageA.evaluate(()=>window.PRIME.state.videoCall.call.id);callIds.push(firstId);await audit(pageA,'ringing',issues,screens,project,'A');
      await expect(pageB.locator('#primecallbanner [data-call-action="accept"]')).toBeVisible({timeout:12000});await audit(pageB,'incoming',issues,screens,project,'B');await pageB.locator('#primecallbanner [data-call-action="accept"]').click();
      const connectedPair=await Promise.all([waitConnected(pageA),waitConnected(pageB)]);firstConnected=connectedPair.every(Boolean);const firstA=await state(pageA),firstB=await state(pageB);if(!firstConnected)add(issues,'CRITICAL','FIRST_CALL_STUCK_CONNECTING','Первый реальный звонок не соединился','После accept хотя бы один участник остался в connecting несмотря на WebRTC/TURN/relay fallback.',{caller:firstA,callee:firstB});
      if(firstConnected){await audit(pageA,'connected',issues,screens,project,'A');await audit(pageB,'connected',issues,screens,project,'B');for(const [s,who] of [[firstA,'A'],[firstB,'B']]){if(!s.localTracks.some(t=>t.kind==='audio'&&t.readyState==='live'))add(issues,'HIGH','LOCAL_AUDIO_MISSING',`${who}: нет live audio track`,'Соединённый звонок должен держать живой локальный микрофон.',s);if(!s.localTracks.some(t=>t.kind==='video'&&t.readyState==='live'))add(issues,'HIGH','LOCAL_VIDEO_MISSING',`${who}: нет live video track`,'Соединённый видеозвонок должен держать живую локальную камеру.',s)}}
      await pageB.waitForTimeout(1800);if(await pageB.locator('#primecallbanner:not(.hidden)').isVisible().catch(()=>false))add(issues,'HIGH','INCOMING_REAPPEARS_AFTER_ACCEPT','Входящий баннер появился снова после принятия','После accept тот же входящий звонок не должен возвращаться повторно.');
      if(firstConnected){const mute=pageA.locator('#primecall [data-call-action="mute"]');await mute.click();await pageA.waitForTimeout(120);let s=await state(pageA);if(!s.localTracks.find(t=>t.kind==='audio')||s.localTracks.find(t=>t.kind==='audio')?.enabled!==false)add(issues,'MEDIUM','MUTE_TOGGLE_FAILED','Mute не выключил audio track','Кнопка микрофона не меняет реальный MediaStreamTrack.enabled.',s);await mute.click();const cam=pageA.locator('#primecall [data-call-action="camera"]');await cam.click();await pageA.waitForTimeout(120);s=await state(pageA);if(s.localTracks.find(t=>t.kind==='video')?.enabled!==false)add(issues,'MEDIUM','CAMERA_TOGGLE_FAILED','Camera off не выключил video track','Кнопка камеры не меняет реальный video MediaStreamTrack.enabled.',s);await cam.click()}
      await pageB.locator('#primecall [data-call-action="hang"]').click();const reset1=await Promise.all([waitReset(pageA),waitReset(pageB)]);if(!reset1.every(Boolean))add(issues,'HIGH','REMOTE_HANG_RESET_FAILED','Завершение не очистило UI у обоих','После hang экран и state звонка должны исчезнуть на обеих сторонах.',{a:await state(pageA),b:await state(pageB)});

      let blockPoll=true;await pageA.route('**/functions/v1/prime-call?**',async route=>{const u=new URL(route.request().url());if(blockPoll&&u.searchParams.get('action')==='poll'&&simulatedPollFailures<2){simulatedPollFailures++;return route.abort('internetdisconnected')}return route.continue()});
      await startUiCall(pageA,pairData.b.handle);await pageA.waitForFunction(()=>window.PRIME?.state?.videoCall?.call?.status==='ringing',null,{timeout:18000});const secondId=await pageA.evaluate(()=>window.PRIME.state.videoCall.call.id);callIds.push(secondId);await expect(pageB.locator('#primecallbanner [data-call-action="accept"]')).toBeVisible({timeout:12000});await pageB.locator('#primecallbanner [data-call-action="accept"]').click();setTimeout(()=>{blockPoll=false},1800);
      const secondPair=await Promise.all([waitConnected(pageA,40000),waitConnected(pageB,40000)]);secondConnected=secondPair.every(Boolean);const secondA=await state(pageA),secondB=await state(pageB);if(!secondConnected)add(issues,'CRITICAL','RECOVERY_CALL_STUCK_CONNECTING','Звонок не восстановился после двух потерянных poll','Краткий сетевой сбой signaling не должен оставлять бесконечное «Соединяю».',{blockedPolls:simulatedPollFailures,caller:secondA,callee:secondB});
      if(simulatedPollFailures<2)add(issues,'LOW','POLL_FAILURE_SIMULATION_SHORT','Смоделировано меньше двух poll failures','Network-recovery ветка была нагружена слабее запланированного.',{simulatedPollFailures});
      if(secondConnected){await audit(pageA,'reconnected',issues,screens,project,'A');await audit(pageB,'reconnected',issues,screens,project,'B')}
      await pageA.locator('#primecall [data-call-action="hang"]').click().catch(()=>{});await Promise.all([waitReset(pageA),waitReset(pageB)]);
      if(pageErrors.length)add(issues,'CRITICAL','CALL_PAGE_ERRORS',`JS exceptions: ${pageErrors.length}`,'Во время звонков возникли необработанные JavaScript ошибки.',{sample:pageErrors.slice(0,8)});if(http5.length)add(issues,'HIGH','CALL_HTTP_5XX',`HTTP 5xx: ${http5.length}`,'Call backend вернул серверную ошибку.',{sample:http5.slice(0,8)});const unexpectedFailures=requestFailures.filter(x=>!x.url.includes('example.invalid'));if(unexpectedFailures.length)add(issues,'MEDIUM','CALL_REQUEST_FAILURES',`Неожиданных request failures: ${unexpectedFailures.length}`,'Сетевые запросы звонка оборвались вне специально смоделированных poll failures.',{sample:unexpectedFailures.slice(0,8)});
    }catch(e){add(issues,'CRITICAL','CALL_VERIFY_FATAL','Calls Deep QA оборвался','Сценарий не смог пройти полный lifecycle звонка.',{error:String(e?.stack||e).slice(0,4000)})}
    finally{
      const finalA=pageA?await state(pageA).catch(()=>null):null,finalB=pageB?await state(pageB).catch(()=>null):null;save(project,{run_id:RUN,project,duration_ms:Date.now()-started,api_duplicate_ok:apiDuplicateOk,api_decline_ok:apiDeclineOk,api_cancel_ok:apiCancelOk,turn_config_ok:turnConfigOk,first_connected:firstConnected,second_connected:secondConnected,simulated_poll_failures:simulatedPollFailures,final_a:finalA,final_b:finalB,issues,screens,page_errors:pageErrors,http_5xx:http5,request_failures:requestFailures});await ctxA?.close().catch(()=>{});await ctxB?.close().catch(()=>{});await cleanup(request,pairData,callIds)}
    expect(issues.filter(x=>x.severity==='CRITICAL'||x.severity==='HIGH'),'Blocking PRIME Calls bugs').toHaveLength(0);
  });
}
