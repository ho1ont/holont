import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const SUPABASE='https://lqnnqsopdqnibbyzoakc.supabase.co';
const AUTH=`${SUPABASE}/functions/v1/prime-auth`;
const RUN_ID=String(process.env.GITHUB_RUN_ID||Date.now());
const VIEWS=[['cardv',/TODAY|LIVE/i],['checkv',/CHECK/i],['calv',/CAL|КАЛЕНДАР/i],['friendsv',/SOCIAL/i]];
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'screen';
const add=(a,severity,code,title,meaning,detail={})=>a.push({severity,code,title,meaning,detail});

async function qaToken(request,project){
  const suffix=slug(project).replace(/-/g,'').slice(0,12);
  const qa={email:`qa2-${RUN_ID}-${suffix}@prime.invalid`,password:`PrimeQA-${RUN_ID}-${suffix}-X9!`,handle:`qa2_${String(RUN_ID).slice(-10)}_${suffix}`.slice(0,32),display_name:`QA 2.0 ${suffix}`.slice(0,32)};
  fs.mkdirSync('artifacts',{recursive:true});
  fs.appendFileSync('artifacts/qa-accounts.ndjson',JSON.stringify({email:qa.email,handle:qa.handle,run_id:RUN_ID,project})+'\n');
  let r=await request.post(AUTH,{data:{action:'signup',...qa}}),b=await r.json().catch(()=>({}));
  if(r.ok()&&b?.token)return b.token;
  r=await request.post(AUTH,{data:{action:'login',email:qa.email,password:qa.password}});b=await r.json().catch(()=>({}));
  if(!r.ok()||!b?.token)throw new Error(`QA auth failed ${r.status()} ${JSON.stringify(b).slice(0,400)}`);
  return b.token;
}

async function dismissBlockingUI(page){
  const sels=['#releasecontinue','.prime-guide-skip','[data-prime-guide="skip"]','[data-action="onboard-skip"]','button:has-text("ПРОПУСТИТЬ")','button:has-text("Пропустить")','button:has-text("ВОЙТИ В PRIME")'];
  for(let pass=0;pass<2;pass++){
    for(const sel of sels){const e=page.locator(sel).first();if(await e.isVisible().catch(()=>false)){await e.click({timeout:2200}).catch(()=>null);await page.waitForTimeout(280)}}
  }
}

async function auditDOM(page){return page.evaluate(()=>{
  const vis=el=>{if(!el)return false;const c=getComputedStyle(el),r=el.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity||1)>.02&&r.width>0&&r.height>0};
  const label=el=>(el?.getAttribute?.('aria-label')||el?.textContent||el?.id||el?.tagName||'').trim().replace(/\s+/g,' ').slice(0,110);
  const vw=innerWidth,vh=innerHeight;
  const overlayRoots=['sheetback','releasegate','onboard','avatarviewer'].map(id=>document.getElementById(id)).filter(vis),root=overlayRoots[0]||document;
  const controls=[...root.querySelectorAll('button,a[href],input,textarea,select,[role="button"]')].filter(vis);
  const offscreen=[],covered=[],tiny=[],overflowElements=[];
  const scrollAncestor=el=>{let p=el.parentElement;while(p&&p!==document.body){const c=getComputedStyle(p);if(/(auto|scroll)/.test(`${c.overflowX} ${c.overflowY}`))return true;p=p.parentElement}return false};
  for(const el of controls.slice(0,220)){
    if(el.disabled||el.getAttribute('aria-disabled')==='true')continue;const r=el.getBoundingClientRect(),name=label(el);
    if(!scrollAncestor(el)&&(r.left<-4||r.right>vw+4))offscreen.push({name,left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)});
    if(r.bottom>=0&&r.top<=vh){const x=Math.max(1,Math.min(vw-1,r.left+r.width/2)),y=Math.max(1,Math.min(vh-1,r.top+r.height/2)),top=document.elementFromPoint(x,y);if(top&&!(top===el||el.contains(top)||top.contains(el)))covered.push({name,coveredBy:label(top),top:Math.round(r.top),bottom:Math.round(r.bottom)})}
    if((el.tagName==='BUTTON'||el.getAttribute('role')==='button')&&r.width<36&&r.height<36)tiny.push({name,width:Math.round(r.width),height:Math.round(r.height)});
  }
  for(const el of [...document.querySelectorAll('body *')].filter(vis).slice(0,800)){if(scrollAncestor(el))continue;const r=el.getBoundingClientRect();if(r.width>vw*2.5)continue;if(r.left<-4||r.right>vw+4)overflowElements.push({name:label(el),tag:el.tagName,id:el.id,cls:String(el.className||'').slice(0,100),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)})}
  const oldX=scrollX,oldY=scrollY;window.scrollTo(50,oldY);const horizontalScrollable=scrollX>1;window.scrollTo(oldX,oldY);
  const activeViews=[...document.querySelectorAll('#app .view.on')].filter(vis).map(e=>e.id||String(e.className));
  const brokenImages=[...document.images].filter(vis).filter(i=>i.complete&&(!i.naturalWidth||!i.naturalHeight)).map(i=>(i.currentSrc||i.src||'').slice(0,180));
  const loaders=[...document.querySelectorAll('.planloading,.planbuilding,.insightsloading,.pushbusy,[aria-busy="true"]')].filter(vis).map(label);
  const n=document.querySelector('.prime-navigator-more');const navigatorCard=n&&vis(n)?{children:n.children.length,hasMoreCopy:!!n.querySelector('.morecopy'),text:label(n),width:Math.round(n.getBoundingClientRect().width),height:Math.round(n.getBoundingClientRect().height)}:null;
  return{viewport:{w:vw,h:vh},overflow:Math.max(0,document.documentElement.scrollWidth-vw),horizontalScrollable,overflowElements:overflowElements.slice(0,20),bodyText:(document.body.innerText||'').trim().length,activeViews,overlayCount:overlayRoots.length,overlayIds:overlayRoots.map(x=>x.id),offscreen,covered,tiny,brokenImages,loaders,navigatorCard};
})}

async function waitStable(page,id){
  await page.waitForTimeout(650);
  if(id==='checkv'){
    const t=Date.now();while(Date.now()-t<4500){const connecting=await page.getByText(/NERVE CONNECTING/i).isVisible().catch(()=>false);if(!connecting)break;await page.waitForTimeout(350)}
  }
  await dismissBlockingUI(page);
}

async function waitLoaders(page,max=4500){const t=Date.now();while(Date.now()-t<max){const a=await auditDOM(page);if(!a.loaders.length)return{stuck:false,loaders:[]};await page.waitForTimeout(300)}const a=await auditDOM(page);return{stuck:!!a.loaders.length,loaders:a.loaders}}

async function navButton(page,id,rx){
  const cs=[page.locator(`[data-x-view="${id}"]`).first(),page.locator(`[data-v="${id}"]`).first(),page.getByRole('button',{name:rx}).first()];
  for(const c of cs)if(await c.isVisible().catch(()=>false))return c;return null;
}
async function openView(page,id,rx,issues){await dismissBlockingUI(page);const b=await navButton(page,id,rx);if(!b){add(issues,'HIGH','NAV_TAB_MISSING',`${id}: нет кнопки навигации`,'Основной раздел недоступен через видимую навигацию.',{id});return false}try{await b.click({timeout:3500})}catch(e){add(issues,'HIGH','NAV_TAP_FAILED',`${id}: тап заблокирован`,'Кнопка видима, но обычный пользовательский тап перехватывается другим слоем.',{error:String(e).slice(0,350)});return false}await waitStable(page,id);const ok=await page.locator(`#${id}`).first().isVisible().catch(()=>false);if(!ok)add(issues,'HIGH','NAV_WRONG_TARGET',`${id}: открылся не тот экран`,'После тапа ожидаемый view не стал видимым.',{id});return ok}

function save(project,r){fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync(`artifacts/autopilot-${project}.json`,JSON.stringify(r,null,2));const c=r.issues.reduce((a,x)=>(a[x.severity]=(a[x.severity]||0)+1,a),{}),o=[`# PRIME QA Autopilot 2.0 — ${project}`,'',`- Run: ${RUN_ID}`,`- Release: ${r.release}`,`- Duration: ${r.duration_ms} ms`,`- Screens: ${r.screens.length}`,`- Issues: ${r.issues.length} (CRITICAL ${c.CRITICAL||0}, HIGH ${c.HIGH||0}, MEDIUM ${c.MEDIUM||0}, LOW ${c.LOW||0})`,'','## Bugs',''];if(!r.issues.length)o.push('Подтверждённых проблем не найдено.');r.issues.forEach((x,i)=>o.push(`### BUG-${String(i+1).padStart(3,'0')} · ${x.severity} · ${x.code}`,`**Баг:** ${x.title}`,`**Что это значит:** ${x.meaning}`,`**Детали:** \`${JSON.stringify(x.detail).slice(0,2000)}\``,''));o.push('## Runtime evidence','',`- Console errors: ${r.console_errors.length}`,`- Page errors: ${r.page_errors.length}`,`- Failed requests: ${r.request_failures.length}`,`- HTTP 4xx: ${r.http_4xx.length}`,`- HTTP 5xx: ${r.http_5xx.length}`);fs.writeFileSync(`artifacts/autopilot-${project}.md`,o.join('\n'))}

test('PRIME QA Autopilot 2.0 live production run',async({page,request},testInfo)=>{
  const started=Date.now(),project=testInfo.project.name,issues=[],screens=[],consoleErrors=[],pageErrors=[],requestFailures=[],http4xx=[],http5xx=[];fs.mkdirSync('artifacts/screens',{recursive:true});
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text().slice(0,1200),page:page.url()})});
  page.on('pageerror',e=>pageErrors.push({message:String(e?.message||e).slice(0,1200)}));page.on('requestfailed',r=>requestFailures.push({method:r.method(),url:r.url().slice(0,600),error:r.failure()?.errorText||'failed'}));page.on('response',r=>{if(r.status()>=500)http5xx.push({status:r.status(),url:r.url().slice(0,600)});else if(r.status()>=400)http4xx.push({status:r.status(),url:r.url().slice(0,600)})});
  let release='unknown',fatal=null;
  const audit=async label=>{await dismissBlockingUI(page);const ld=await waitLoaders(page);if(ld.stuck)add(issues,'HIGH','STUCK_LOADER',`${label}: loader не исчез`,'Экран остаётся в состоянии загрузки слишком долго.',{loaders:ld.loaders});const a=await auditDOM(page),shot=`artifacts/screens/${slug(project)}-${slug(label)}.png`;await page.screenshot({path:shot,fullPage:false});screens.push({label,screenshot:shot,audit:a});if(a.bodyText<10)add(issues,'CRITICAL','BLANK_SCREEN',`${label}: пустой экран`,'PRIME не отрисовался.',{bodyText:a.bodyText});if(a.overflow>4&&a.horizontalScrollable)add(issues,'HIGH','HORIZONTAL_SCROLL',`${label}: страницу можно сдвинуть по X`,'Появился реальный горизонтальный скролл на iPhone.',{overflow:a.overflow,elements:a.overflowElements});if(a.activeViews.length!==1)add(issues,'HIGH','ACTIVE_VIEW_COUNT',`${label}: active views ${a.activeViews.length}`,'Несколько разделов активны одновременно или ни один.',{activeViews:a.activeViews});if(a.overlayCount>1)add(issues,'HIGH','MULTIPLE_OVERLAYS',`${label}: ${a.overlayCount} оверлея`,'Несколько независимых модалок блокируют UI.',{overlayIds:a.overlayIds});if(a.offscreen.length)add(issues,'MEDIUM','OFFSCREEN_CONTROLS',`${label}: контролы за экраном`,'Часть интерактивных элементов физически выходит за viewport.',{elements:a.offscreen});if(a.covered.length)add(issues,'HIGH','COVERED_TAP_TARGET',`${label}: кнопка перекрыта`,'В центре видимой кнопки hit-test попадает в другой слой.',{elements:a.covered});if(a.brokenImages.length)add(issues,'MEDIUM','BROKEN_IMAGE',`${label}: битое изображение`,'Картинка не загрузилась.',{images:a.brokenImages});if(a.navigatorCard&&(!a.navigatorCard.hasMoreCopy||a.navigatorCard.children<3))add(issues,'HIGH','NAVIGATOR_CARD_LAYOUT',`${label}: карточка НАВИГАТОР развалена`,'Разметка карточки не соответствует трёхколоночной сетке moreitem; текст и ? съезжают.',a.navigatorCard);return a};
  try{
    const token=await qaToken(request,project);await page.addInitScript(t=>{localStorage.setItem('prime_token',t);window.__primeQA={cls:0};try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__primeQA.cls+=(e.value||0)}).observe({type:'layout-shift',buffered:true})}catch{}},token);
    const nav=await page.goto('/',{waitUntil:'domcontentloaded',timeout:20000});if(!nav||nav.status()>=500)add(issues,'CRITICAL','BOOT_HTTP','Production не загрузился','Сервер вернул 5xx до интерфейса.',{status:nav?.status()});await page.waitForTimeout(1200);await dismissBlockingUI(page);await expect(page.locator('#app')).toBeVisible();release=await page.evaluate(()=>window.PRIME_RELEASE||'unknown');await audit('boot-live');
    for(const[id,rx]of VIEWS)if(await openView(page,id,rx,issues))await audit(id);
    await dismissBlockingUI(page);const more=page.locator('#moremenu').first();if(await more.isVisible().catch(()=>false)){await more.click({timeout:3500});await page.waitForTimeout(350);await audit('more-menu');const back=page.locator('#sheetback');if(await back.isVisible().catch(()=>false)){await back.click({position:{x:2,y:2},timeout:2500}).catch(()=>null);await page.waitForTimeout(450);if(await back.isVisible().catch(()=>false))add(issues,'MEDIUM','OUTSIDE_TAP_NOT_DISMISSED','Тап по фону не закрыл меню','Sheet остаётся открытым после тапа вне него.')}}
    await dismissBlockingUI(page);for(let i=0;i<20;i++){const[id,rx]=VIEWS[i%4],b=await navButton(page,id,rx);if(!b){add(issues,'HIGH','STRESS_NAV_MISSING',`Stress: ${id} исчезла`,'После быстрых переключений навигация пропала.',{iteration:i});break}try{await b.click({timeout:2200})}catch(e){add(issues,'HIGH','STRESS_TAP_FAILED',`Stress: ${id} не нажалась`,'Навигация перестала принимать тап при быстрой смене экранов.',{iteration:i,error:String(e).slice(0,300)});break}await page.waitForTimeout(70)}await page.waitForTimeout(500);await audit('stress-after-20-tabs');const motion=await page.evaluate(()=>window.__primeQA||{cls:0});if(Number(motion.cls)>.25)add(issues,'MEDIUM','LAYOUT_SHIFT','Сильный layout shift','Интерфейс самопроизвольно заметно прыгает.',{cls:motion.cls});
  }catch(e){fatal=String(e?.stack||e).slice(0,4000);add(issues,'CRITICAL','AUTOPILOT_FATAL','Прогон оборвался','Ошибка сохранена в отчёт; тест не завис молча.',{error:fatal})}
  finally{if(pageErrors.length)add(issues,'CRITICAL','PAGE_ERRORS',`Page exceptions: ${pageErrors.length}`,'Есть необработанные JS исключения.',{sample:pageErrors.slice(0,8)});if(requestFailures.length)add(issues,'MEDIUM','REQUEST_FAILURES',`Failed requests: ${requestFailures.length}`,'Сетевые запросы физически оборвались.',{sample:requestFailures.slice(0,10)});if(http5xx.length)add(issues,'HIGH','HTTP_5XX',`HTTP 5xx: ${http5xx.length}`,'Backend PRIME вернул серверную ошибку.',{sample:http5xx.slice(0,10)});const unexpected4=http4xx.filter(x=>!x.url.includes('/manifest')&&!x.url.includes('favicon'));if(unexpected4.length)add(issues,'MEDIUM','HTTP_4XX',`HTTP 4xx: ${unexpected4.length}`,'Во время обычного сценария production обращается к endpoint, который отвечает клиентской ошибкой.',{sample:unexpected4.slice(0,10)});if(consoleErrors.length)add(issues,'MEDIUM','CONSOLE_ERRORS',`Console errors: ${consoleErrors.length}`,'Браузер пишет ошибки в production-консоль.',{sample:consoleErrors.slice(0,8)});save(project,{run_id:RUN_ID,project,url:page.url(),release,duration_ms:Date.now()-started,issues,screens,console_errors:consoleErrors,page_errors:pageErrors,request_failures:requestFailures,http_4xx:http4xx,http_5xx:http5xx,fatal})}
  expect(issues.filter(x=>x.severity==='CRITICAL'||x.severity==='HIGH'),'HIGH/CRITICAL app issues; inspect evidence').toHaveLength(0);
});
