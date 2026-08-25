import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const SUPABASE = 'https://lqnnqsopdqnibbyzoakc.supabase.co';
const AUTH = `${SUPABASE}/functions/v1/prime-auth`;
const RUN_ID = String(process.env.GITHUB_RUN_ID || Date.now());
const VIEWS = [
  ['cardv', /^(TODAY|LIVE)$/i],
  ['checkv', /CHECK/i],
  ['calv', /^(CAL|КАЛЕНДАРЬ)$/i],
  ['friendsv', /SOCIAL/i],
];
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'screen';

function issue(list, severity, code, title, meaning, detail = {}) {
  list.push({ severity, code, title, meaning, detail });
}

async function qaToken(request, project) {
  const suffix = slug(project).replace(/-/g, '').slice(0, 12);
  const qa = {
    email: `qa2-${RUN_ID}-${suffix}@prime.invalid`,
    password: `PrimeQA-${RUN_ID}-${suffix}-X9!`,
    handle: `qa2_${String(RUN_ID).slice(-10)}_${suffix}`.slice(0, 32),
    display_name: `QA 2.0 ${suffix}`.slice(0, 32),
  };
  fs.mkdirSync('artifacts', { recursive: true });
  fs.appendFileSync('artifacts/qa-accounts.ndjson', JSON.stringify({ ...qa, password: undefined, run_id: RUN_ID, project }) + '\n');
  const signup = await request.post(AUTH, { data: { action: 'signup', ...qa } });
  let body = await signup.json().catch(() => ({}));
  if (signup.ok() && body?.token) return body.token;
  const login = await request.post(AUTH, { data: { action: 'login', email: qa.email, password: qa.password } });
  body = await login.json().catch(() => ({}));
  if (!login.ok() || !body?.token) throw new Error(`QA auth failed signup=${signup.status()} login=${login.status()} ${JSON.stringify(body).slice(0, 400)}`);
  return body.token;
}

async function dismissBlockingUI(page) {
  const selectors = [
    '#releasecontinue',
    '[data-prime-guide="skip"]',
    '[data-action="onboard-skip"]',
    'button:has-text("ПРОПУСТИТЬ")',
    'button:has-text("ВОЙТИ В PRIME")',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2500 }).catch(() => null);
      await page.waitForTimeout(300);
    }
  }
}

async function auditDOM(page) {
  return page.evaluate(() => {
    const visible = el => {
      if (!el) return false;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > .02 && r.width > 0 && r.height > 0;
    };
    const vw = innerWidth, vh = innerHeight;
    const overlayRoots = ['sheetback','releasegate','onboard','avatarviewer']
      .map(id => document.getElementById(id)).filter(visible);
    const root = overlayRoots[0] || document;
    const controls = [...root.querySelectorAll('button,a[href],input,textarea,select,[role="button"]')].filter(visible);
    const offscreen = [], covered = [], tiny = [], overflowElements = [];

    const scrollAncestor = el => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(`${cs.overflowX} ${cs.overflowY}`)) return true;
        p = p.parentElement;
      }
      return false;
    };
    const label = el => (el.getAttribute?.('aria-label') || el.textContent || el.id || el.tagName || '').trim().replace(/\s+/g,' ').slice(0,100);

    for (const el of controls.slice(0, 180)) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const r = el.getBoundingClientRect(), name = label(el);
      if (!scrollAncestor(el) && (r.left < -4 || r.right > vw + 4)) offscreen.push({ name, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
      if (r.bottom >= 0 && r.top <= vh) {
        const x = Math.max(1, Math.min(vw - 1, r.left + r.width / 2));
        const y = Math.max(1, Math.min(vh - 1, r.top + r.height / 2));
        const top = document.elementFromPoint(x, y);
        if (top && !(top === el || el.contains(top) || top.contains(el))) covered.push({ name, coveredBy: label(top) });
      }
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && r.width < 36 && r.height < 36) tiny.push({ name, width: Math.round(r.width), height: Math.round(r.height) });
    }

    for (const el of [...document.querySelectorAll('body *')].filter(visible).slice(0, 700)) {
      if (scrollAncestor(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > vw * 2.5) continue;
      if (r.left < -4 || r.right > vw + 4) overflowElements.push({ name: label(el), tag: el.tagName, id: el.id, cls: String(el.className || '').slice(0,100), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
    }

    const activeViews = [...document.querySelectorAll('#app .view.on')].filter(visible).map(el => el.id || String(el.className));
    const brokenImages = [...document.images].filter(visible).filter(i => i.complete && (!i.naturalWidth || !i.naturalHeight)).map(i => (i.currentSrc || i.src || '').slice(0,180));
    const loaders = [...document.querySelectorAll('.planloading,.planbuilding,.insightsloading,.pushbusy,[aria-busy="true"]')].filter(visible).map(label);
    const navCard = document.querySelector('.prime-navigator-more');
    const navigatorCard = navCard && visible(navCard) ? {
      children: navCard.children.length,
      hasMoreCopy: !!navCard.querySelector('.morecopy'),
      text: label(navCard),
      width: Math.round(navCard.getBoundingClientRect().width),
      height: Math.round(navCard.getBoundingClientRect().height),
    } : null;
    return {
      viewport: { w: vw, h: vh },
      overflow: Math.max(0, document.documentElement.scrollWidth - vw),
      bodyText: (document.body.innerText || '').trim().length,
      activeViews,
      overlayCount: overlayRoots.length,
      overlayIds: overlayRoots.map(x => x.id),
      offscreen, covered, tiny, overflowElements: overflowElements.slice(0,20),
      brokenImages, loaders, navigatorCard,
    };
  });
}

async function waitLoaders(page, maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const a = await auditDOM(page);
    if (!a.loaders.length) return { stuck:false, loaders:[] };
    await page.waitForTimeout(300);
  }
  const a = await auditDOM(page);
  return { stuck: !!a.loaders.length, loaders:a.loaders };
}

async function navButton(page, id, textRx) {
  const candidates = [
    page.locator(`[data-v="${id}"]`).filter({ visible:true }).first(),
    page.getByRole('button', { name: textRx }).first(),
    page.getByText(textRx, { exact:true }).first(),
  ];
  for (const c of candidates) if (await c.isVisible().catch(() => false)) return c;
  return null;
}

async function openView(page, id, textRx, issues) {
  await dismissBlockingUI(page);
  const b = await navButton(page, id, textRx);
  if (!b) {
    issue(issues,'HIGH','NAV_TAB_MISSING',`Не найдена навигация ${id}`,'Пользователь не может открыть один из основных разделов.',{id});
    return false;
  }
  await b.click({ timeout:4000 }).catch(e => issue(issues,'HIGH','NAV_TAP_FAILED',`${id}: тап не сработал`,'Кнопка видна, но браузер не смог выполнить обычный пользовательский тап.',{error:String(e).slice(0,300)}));
  await page.waitForTimeout(320);
  const v = page.locator(`#${id}`).first();
  const ok = await v.isVisible().catch(() => false);
  if (!ok) issue(issues,'HIGH','NAV_WRONG_TARGET',`${id}: экран не открылся`,'После тапа ожидаемый раздел не стал видимым.',{id});
  return ok;
}

function saveReport(project, report) {
  fs.mkdirSync('artifacts', { recursive:true });
  fs.writeFileSync(`artifacts/autopilot-${project}.json`, JSON.stringify(report,null,2));
  const counts = report.issues.reduce((a,x)=>(a[x.severity]=(a[x.severity]||0)+1,a),{});
  const out = [
    `# PRIME QA Autopilot 2.0 — ${project}`,'',
    `- Run: ${RUN_ID}`,
    `- Release: ${report.release}`,
    `- Duration: ${report.duration_ms} ms`,
    `- Screens: ${report.screens.length}`,
    `- Issues: ${report.issues.length} (CRITICAL ${counts.CRITICAL||0}, HIGH ${counts.HIGH||0}, MEDIUM ${counts.MEDIUM||0}, LOW ${counts.LOW||0})`,'','## Bugs',''
  ];
  if (!report.issues.length) out.push('Подтверждённых проблем в этом прогоне не найдено.');
  report.issues.forEach((x,i)=>out.push(`### BUG-${String(i+1).padStart(3,'0')} · ${x.severity} · ${x.code}`,`**Баг:** ${x.title}`,`**Что это значит:** ${x.meaning}`,`**Детали:** \`${JSON.stringify(x.detail).slice(0,1800)}\``,''));
  out.push('## Runtime evidence','',`- Console errors: ${report.console_errors.length}`,`- Page errors: ${report.page_errors.length}`,`- Failed requests: ${report.request_failures.length}`,`- HTTP 5xx: ${report.http_5xx.length}`);
  fs.writeFileSync(`artifacts/autopilot-${project}.md`,out.join('\n'));
}

test('PRIME QA Autopilot 2.0 live production run', async ({ page, request }, testInfo) => {
  const started=Date.now(), project=testInfo.project.name;
  const issues=[],screens=[],consoleErrors=[],pageErrors=[],requestFailures=[],http5xx=[];
  fs.mkdirSync('artifacts/screens',{recursive:true});
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text().slice(0,1200),url:page.url()})});
  page.on('pageerror',e=>pageErrors.push({message:String(e?.message||e).slice(0,1200)}));
  page.on('requestfailed',r=>requestFailures.push({method:r.method(),url:r.url().slice(0,600),error:r.failure()?.errorText||'failed'}));
  page.on('response',r=>{if(r.status()>=500)http5xx.push({status:r.status(),url:r.url().slice(0,600)})});
  let release='unknown',fatal=null;

  const audit = async label => {
    await dismissBlockingUI(page);
    const ld=await waitLoaders(page);
    if(ld.stuck)issue(issues,'HIGH','STUCK_LOADER',`${label}: бесконечная загрузка`,'Loader остаётся на экране дольше допустимого.',{loaders:ld.loaders});
    const a=await auditDOM(page);
    const shot=`artifacts/screens/${slug(project)}-${slug(label)}.png`;
    await page.screenshot({path:shot,fullPage:false});screens.push({label,screenshot:shot,audit:a});
    if(a.bodyText<10)issue(issues,'CRITICAL','BLANK_SCREEN',`${label}: пустой экран`,'PRIME фактически не отрисовался.',{bodyText:a.bodyText});
    if(a.overflow>4)issue(issues,'HIGH','HORIZONTAL_OVERFLOW',`${label}: +${a.overflow}px за viewport`,'Интерфейс шире экрана iPhone; возможен нежелательный горизонтальный сдвиг.',{overflow:a.overflow,elements:a.overflowElements});
    if(a.activeViews.length!==1)issue(issues,'HIGH','ACTIVE_VIEW_COUNT',`${label}: активных экранов ${a.activeViews.length}`,'Одновременно активны несколько разделов или ни одного.',{activeViews:a.activeViews});
    if(a.overlayCount>1)issue(issues,'HIGH','MULTIPLE_OVERLAYS',`${label}: ${a.overlayCount} верхнеуровневых модалки`,'Несколько независимых оверлеев одновременно блокируют интерфейс.',{overlayIds:a.overlayIds});
    if(a.offscreen.length)issue(issues,'MEDIUM','OFFSCREEN_CONTROLS',`${label}: элементы за экраном`,'Интерактивные элементы частично недоступны.',{elements:a.offscreen});
    if(a.covered.length)issue(issues,'HIGH','COVERED_TAP_TARGET',`${label}: перекрытые тапы`,'Видимую кнопку в центре перекрывает другой слой.',{elements:a.covered});
    if(a.brokenImages.length)issue(issues,'MEDIUM','BROKEN_IMAGE',`${label}: битая картинка`,'Изображение не загрузилось.',{images:a.brokenImages});
    if(a.navigatorCard && (!a.navigatorCard.hasMoreCopy || a.navigatorCard.children<3))issue(issues,'HIGH','NAVIGATOR_CARD_LAYOUT',`${label}: карточка НАВИГАТОР сломана`,'Карточка вставлена в трёхколоночный layout неправильной структурой, из-за чего текст и ? съезжают.',a.navigatorCard);
    return a;
  };

  try {
    const token=await qaToken(request,project);
    await page.addInitScript(t=>{localStorage.setItem('prime_token',t);window.__primeQA={cls:0};try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__primeQA.cls+=(e.value||0)}).observe({type:'layout-shift',buffered:true})}catch{}},token);
    const nav=await page.goto('/',{waitUntil:'domcontentloaded',timeout:20000});
    if(!nav||nav.status()>=500)issue(issues,'CRITICAL','BOOT_HTTP','Production не загрузился','Сервер вернул ошибку до UI.',{status:nav?.status()});
    await page.waitForTimeout(1300);await dismissBlockingUI(page);await expect(page.locator('#app')).toBeVisible();
    release=await page.evaluate(()=>window.PRIME_RELEASE||window.PRIME?.build||'unknown');
    await audit('boot-live');

    for(const [id,rx] of VIEWS) if(await openView(page,id,rx,issues)) await audit(id);

    const more=page.locator('#moremenu,button[aria-label*="меню" i],button:has-text("•••"),button:has-text("⋯")').first();
    if(await more.isVisible().catch(()=>false)){
      await more.click();await page.waitForTimeout(350);await audit('more-menu');
      const back=page.locator('#sheetback');
      if(await back.isVisible().catch(()=>false)){
        await back.click({position:{x:2,y:2},timeout:3000}).catch(()=>null);await page.waitForTimeout(450);
        if(await back.isVisible().catch(()=>false))issue(issues,'MEDIUM','OUTSIDE_TAP_NOT_DISMISSED','Тап по фону не закрыл меню','Пользователь тапает вне sheet, но модалка остаётся открыта.');
      }
    }

    await dismissBlockingUI(page);
    for(let i=0;i<20;i++){
      const [id,rx]=VIEWS[i%VIEWS.length];const b=await navButton(page,id,rx);
      if(!b){issue(issues,'HIGH','STRESS_NAV_MISSING',`Stress: ${id} исчезла`,'После быстрых переключений кнопка навигации пропала.',{iteration:i});break}
      await b.click({timeout:2500}).catch(e=>issue(issues,'HIGH','STRESS_TAP_FAILED',`Stress: ${id} не нажалась`,'При быстрых переключениях навигация перестала принимать тап.',{iteration:i,error:String(e).slice(0,250)}));
      await page.waitForTimeout(55);
    }
    await audit('stress-after-20-tabs');

    const motion=await page.evaluate(()=>window.__primeQA||{cls:0});
    if(Number(motion.cls)>0.25)issue(issues,'MEDIUM','LAYOUT_SHIFT','Сильные самопроизвольные сдвиги','UI заметно прыгает без прямого действия пользователя.',{cls:motion.cls});
  }catch(e){fatal=String(e?.stack||e).slice(0,4000);issue(issues,'CRITICAL','AUTOPILOT_FATAL','Прогон оборвался','Автопилот сохранил точную ошибку вместо молчаливого зависания.',{error:fatal});}
  finally{
    if(consoleErrors.length)issue(issues,'HIGH','CONSOLE_ERRORS',`Console errors: ${consoleErrors.length}`,'Во время пользовательского сценария браузер зарегистрировал console.error.',{sample:consoleErrors.slice(0,8)});
    if(pageErrors.length)issue(issues,'CRITICAL','PAGE_ERRORS',`Page exceptions: ${pageErrors.length}`,'Необработанные JavaScript исключения ломают выполнение страницы.',{sample:pageErrors.slice(0,8)});
    if(requestFailures.length)issue(issues,'MEDIUM','REQUEST_FAILURES',`Failed requests: ${requestFailures.length}`,'Сетевые запросы оборвались.',{sample:requestFailures.slice(0,10)});
    if(http5xx.length)issue(issues,'HIGH','HTTP_5XX',`HTTP 5xx: ${http5xx.length}`,'Backend PRIME вернул серверную ошибку.',{sample:http5xx.slice(0,10)});
    saveReport(project,{run_id:RUN_ID,project,url:page.url(),release,duration_ms:Date.now()-started,issues,screens,console_errors:consoleErrors,page_errors:pageErrors,request_failures:requestFailures,http_5xx:http5xx,fatal});
  }
  expect(issues.filter(x=>x.severity==='CRITICAL'||x.severity==='HIGH'), 'HIGH/CRITICAL issues; inspect artifact').toHaveLength(0);
});
