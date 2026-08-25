import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE = 'https://lqnnqsopdqnibbyzoakc.supabase.co';
const AUTH = `${SUPABASE}/functions/v1/prime-auth`;
const RUN_ID = String(process.env.GITHUB_RUN_ID || Date.now());
const QA = {
  email: `qa2-${RUN_ID}@prime.invalid`,
  password: `PrimeQA-${RUN_ID}-X9!`,
  handle: `qa2_${RUN_ID}`.slice(0, 32),
  display_name: `QA 2.0 ${RUN_ID}`.slice(0, 32)
};
const SAFE_TABS = ['cardv', 'checkv', 'calv', 'friendsv'];
const destructive = /удал|очист|выйти|сохран|закрыть день|оценить|принять|начать|сделал|отмен|добав|созд|отправ|звон|call|send|delete|remove|logout|battle|участв/i;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'screen';

function addIssue(list, severity, code, title, meaning, detail = {}) {
  list.push({ severity, code, title, meaning, detail });
}

async function getQAToken(request) {
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/qa-account.json', JSON.stringify({ email: QA.email, handle: QA.handle, run_id: RUN_ID }, null, 2));
  const signup = await request.post(AUTH, { data: { action: 'signup', ...QA } });
  const body = await signup.json().catch(() => ({}));
  if (!signup.ok() || !body?.token) throw new Error(`QA signup failed ${signup.status()}: ${JSON.stringify(body).slice(0, 500)}`);
  return body.token;
}

async function dismissBlockingUI(page) {
  const candidates = [
    '#releasecontinue',
    '[data-prime-guide="skip"]',
    '[data-action="onboard-skip"]',
    'button:has-text("Пропустить")',
    'button:has-text("Продолжить")'
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2500 }).catch(() => null);
      await page.waitForTimeout(250);
    }
  }
}

async function domAudit(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0.02 && r.width > 0 && r.height > 0;
    };
    const controls = [...document.querySelectorAll('button,a[href],input,textarea,select,[role="button"]')].filter(visible);
    const vw = innerWidth, vh = innerHeight;
    const overlays = [...document.querySelectorAll('#sheetback,#releasegate,#onboard,.avatarviewer,[role="dialog"],.modal,.sheet')].filter(visible);
    const offscreen = [], covered = [], tiny = [];
    const scrollAncestor = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(`${cs.overflowX} ${cs.overflowY}`)) return true;
        p = p.parentElement;
      }
      return false;
    };
    for (const el of controls.slice(0, 180)) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 90);
      if (!scrollAncestor(el) && (r.left < -4 || r.right > vw + 4)) offscreen.push({ name, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
      if (r.bottom >= 0 && r.top <= vh) {
        const x = Math.max(1, Math.min(vw - 1, r.left + r.width / 2));
        const y = Math.max(1, Math.min(vh - 1, r.top + r.height / 2));
        const top = document.elementFromPoint(x, y);
        if (top && !(top === el || el.contains(top) || top.contains(el))) covered.push({ name, coveredBy: String(top.id || top.className || top.tagName).slice(0, 110) });
      }
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && r.width < 36 && r.height < 36) tiny.push({ name, width: Math.round(r.width), height: Math.round(r.height) });
    }
    const activeViews = [...document.querySelectorAll('#app .view.on')].filter(visible).map(el => el.id || el.className);
    const brokenImages = [...document.images].filter(visible).filter(i => i.complete && (!i.naturalWidth || !i.naturalHeight)).map(i => (i.currentSrc || i.src || '').slice(0, 180));
    const loaders = [...document.querySelectorAll('.planloading,.planbuilding,.insightsloading,.pushbusy,[aria-busy="true"],.loading,.spinner')].filter(visible).map(el => String(el.id || el.className || el.textContent || 'loader').trim().slice(0, 100));
    const scrollables = [...document.querySelectorAll('*')].filter(visible).filter(el => el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)).slice(0, 20).map(el => ({ id: el.id, cls: String(el.className || '').slice(0, 80), top: el.scrollTop, h: el.clientHeight, sh: el.scrollHeight }));
    return {
      viewport: { w: vw, h: vh },
      overflow: Math.max(0, document.documentElement.scrollWidth - vw),
      bodyText: (document.body.innerText || '').trim().length,
      activeViews,
      overlayCount: overlays.length,
      offscreen,
      covered,
      tiny,
      brokenImages,
      loaders,
      scrollables
    };
  });
}

async function waitForLoaders(page, limit = 5500) {
  const t = Date.now();
  while (Date.now() - t < limit) {
    const a = await domAudit(page);
    if (!a.loaders.length) return { stuck: false, loaders: [] };
    await page.waitForTimeout(300);
  }
  const a = await domAudit(page);
  return { stuck: a.loaders.length > 0, loaders: a.loaders };
}

async function openView(page, id, issues) {
  const tab = page.locator(`button.tab[data-v="${id}"]`).first();
  if (!await tab.isVisible().catch(() => false)) {
    addIssue(issues, 'HIGH', 'NAV_TAB_MISSING', `Не найдена вкладка ${id}`, 'Основная вкладка отсутствует или скрыта.', { id });
    return false;
  }
  await tab.click();
  await page.waitForTimeout(280);
  const view = page.locator(`#${id}`).first();
  const ok = await view.isVisible().catch(() => false);
  if (!ok) addIssue(issues, 'HIGH', 'NAV_WRONG_TARGET', `Вкладка ${id} не открылась`, 'Тап по нижней навигации не приводит к нужному экрану.', { id });
  return ok;
}

function writeReport(project, report) {
  fs.mkdirSync('artifacts', { recursive: true });
  const counts = report.issues.reduce((a, x) => (a[x.severity] = (a[x.severity] || 0) + 1, a), {});
  fs.writeFileSync(`artifacts/autopilot-${project}.json`, JSON.stringify(report, null, 2));
  const lines = [
    `# PRIME QA Autopilot 2.0 — ${project}`,
    '',
    `- Run: ${RUN_ID}`,
    `- URL: ${report.url}`,
    `- Release: ${report.release}`,
    `- Duration: ${report.duration_ms} ms`,
    `- Screens: ${report.screens.length}`,
    `- Issues: ${report.issues.length} (CRITICAL ${counts.CRITICAL || 0}, HIGH ${counts.HIGH || 0}, MEDIUM ${counts.MEDIUM || 0}, LOW ${counts.LOW || 0})`,
    '', '## Bugs', ''
  ];
  if (!report.issues.length) lines.push('Подтверждённых проблем в этом прогоне не найдено.');
  report.issues.forEach((x, i) => {
    lines.push(`### BUG-${String(i + 1).padStart(3, '0')} · ${x.severity} · ${x.code}`);
    lines.push(`**Баг:** ${x.title}`);
    lines.push(`**Что это значит:** ${x.meaning}`);
    lines.push(`**Детали:** \`${JSON.stringify(x.detail).slice(0, 1800)}\``);
    lines.push('');
  });
  lines.push('## Runtime evidence', '', `- Console errors: ${report.console_errors.length}`, `- Page errors: ${report.page_errors.length}`, `- Failed requests: ${report.request_failures.length}`, `- HTTP 5xx: ${report.http_5xx.length}`);
  fs.writeFileSync(`artifacts/autopilot-${project}.md`, lines.join('\n'));
}

test('PRIME QA Autopilot 2.0 live production run', async ({ page, request }, testInfo) => {
  const started = Date.now();
  const project = testInfo.project.name;
  const issues = [], screens = [], consoleErrors = [], pageErrors = [], requestFailures = [], http5xx = [];
  fs.mkdirSync('artifacts/screens', { recursive: true });

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text().slice(0, 1200), url: page.url() }); });
  page.on('pageerror', e => pageErrors.push({ message: String(e?.message || e).slice(0, 1200) }));
  page.on('requestfailed', r => requestFailures.push({ method: r.method(), url: r.url().slice(0, 600), error: r.failure()?.errorText || 'failed' }));
  page.on('response', r => { if (r.status() >= 500) http5xx.push({ status: r.status(), url: r.url().slice(0, 600) }); });

  let release = 'unknown';
  let fatal = null;
  const audit = async (label) => {
    await dismissBlockingUI(page);
    const ld = await waitForLoaders(page);
    if (ld.stuck) addIssue(issues, 'HIGH', 'STUCK_LOADER', `${label}: загрузка не заканчивается`, 'На экране остаётся loader и пользователь может застрять.', { loaders: ld.loaders });
    const a = await domAudit(page);
    const shot = `artifacts/screens/${slug(project)}-${slug(label)}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    screens.push({ label, screenshot: shot, audit: a });
    if (a.bodyText < 10) addIssue(issues, 'CRITICAL', 'BLANK_SCREEN', `${label}: пустой экран`, 'Интерфейс практически не отрисовался.', { bodyText: a.bodyText });
    if (a.overflow > 4) addIssue(issues, 'HIGH', 'HORIZONTAL_OVERFLOW', `${label}: интерфейс шире viewport на ${a.overflow}px`, 'Есть нежелательный горизонтальный выход за экран.', { overflow: a.overflow });
    if (a.activeViews.length !== 1) addIssue(issues, 'HIGH', 'ACTIVE_VIEW_COUNT', `${label}: активных экранов ${a.activeViews.length}`, 'Экраны могут накладываться или ни один экран не активен.', { activeViews: a.activeViews });
    if (a.overlayCount > 1) addIssue(issues, 'HIGH', 'MULTIPLE_OVERLAYS', `${label}: одновременно ${a.overlayCount} оверлея`, 'Модальные слои накладываются и могут блокировать тапы.', { overlayCount: a.overlayCount });
    if (a.offscreen.length) addIssue(issues, 'MEDIUM', 'OFFSCREEN_CONTROLS', `${label}: элементы выходят за экран`, 'Некоторые кнопки/поля частично недоступны на iPhone.', { elements: a.offscreen.slice(0, 12) });
    if (a.covered.length) addIssue(issues, 'HIGH', 'COVERED_TAP_TARGET', `${label}: перекрытые точки тапа`, 'Элемент виден, но тап в его центр получает другой слой.', { elements: a.covered.slice(0, 12) });
    if (a.brokenImages.length) addIssue(issues, 'MEDIUM', 'BROKEN_IMAGE', `${label}: битые изображения`, 'Картинка не загрузилась или имеет нулевой размер.', { images: a.brokenImages.slice(0, 12) });
    return a;
  };

  try {
    const token = await getQAToken(request);
    await page.addInitScript((t) => {
      localStorage.setItem('prime_token', t);
      window.__primeQA = { cls: 0, shifts: [] };
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) { window.__primeQA.cls += e.value || 0; window.__primeQA.shifts.push({ value: e.value || 0, at: performance.now() }); }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    }, token);

    const nav = await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (!nav || nav.status() >= 500) addIssue(issues, 'CRITICAL', 'BOOT_HTTP', 'Production не загрузился', 'Сервер вернул ошибку до отрисовки интерфейса.', { status: nav?.status() });
    await page.waitForTimeout(700);
    await dismissBlockingUI(page);
    await expect(page.locator('#app')).toBeVisible();
    release = await page.evaluate(() => window.PRIME_RELEASE || window.PRIME_BUILD || 'unknown');

    await audit('boot-live');

    for (const id of SAFE_TABS) {
      if (await openView(page, id, issues)) await audit(id);
    }

    const moreCandidates = ['#morebtn', '#more', 'button[aria-label*="More" i]', 'button[aria-label*="menu" i]', 'button:has-text("•••")', 'button:has-text("⋯")'];
    let openedMore = false;
    for (const sel of moreCandidates) {
      const b = page.locator(sel).first();
      if (await b.isVisible().catch(() => false)) {
        const txt = ((await b.getAttribute('aria-label')) || (await b.textContent()) || '').trim();
        if (!destructive.test(txt)) {
          await b.click().catch(() => null);
          await page.waitForTimeout(250);
          openedMore = true;
          await audit('more-menu');
          break;
        }
      }
    }

    if (openedMore) {
      const before = await domAudit(page);
      await page.mouse.click(8, Math.min(120, testInfo.project.use.viewport?.height || 120)).catch(() => null);
      await page.waitForTimeout(250);
      const after = await domAudit(page);
      if (before.overlayCount > 0 && after.overlayCount >= before.overlayCount) addIssue(issues, 'MEDIUM', 'OUTSIDE_TAP_NOT_DISMISSED', 'Тап вне меню не закрыл оверлей', 'Пользователь ожидает закрытия меню тапом по фону, но слой остаётся.', { before: before.overlayCount, after: after.overlayCount });
    }

    for (let i = 0; i < 20; i++) {
      const id = SAFE_TABS[i % SAFE_TABS.length];
      const tab = page.locator(`button.tab[data-v="${id}"]`).first();
      if (await tab.isVisible().catch(() => false)) await tab.click({ timeout: 3000 }).catch(e => addIssue(issues, 'HIGH', 'STRESS_TAP_FAILED', `Stress: не нажалась ${id}`, 'При быстрых переключениях навигация перестала принимать тап.', { error: String(e).slice(0, 300), iteration: i }));
      await page.waitForTimeout(45);
    }
    await audit('stress-after-20-tabs');

    for (const id of SAFE_TABS) {
      if (!await openView(page, id, issues)) continue;
      const result = await page.evaluate(() => {
        const els = [...document.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 30 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
        const el = els.sort((a,b) => (b.clientHeight*b.clientWidth)-(a.clientHeight*a.clientWidth))[0];
        if (!el) return { found: false };
        const before = el.scrollTop;
        el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, before + Math.max(120, el.clientHeight * .65));
        return { found: true, before, after: el.scrollTop, max: el.scrollHeight - el.clientHeight, id: el.id, cls: String(el.className || '').slice(0, 100) };
      });
      await page.waitForTimeout(100);
      if (result.found && result.max > 120 && result.after === result.before) addIssue(issues, 'MEDIUM', 'SCROLL_STUCK', `${id}: контейнер не скроллится`, 'Контент длиннее контейнера, но scrollTop не меняется.', result);
    }

    const motion = await page.evaluate(() => window.__primeQA || { cls: 0, shifts: [] });
    if ((motion.cls || 0) > 0.25) addIssue(issues, 'MEDIUM', 'LAYOUT_SHIFT', 'Сильные самопроизвольные сдвиги интерфейса', 'Элементы заметно прыгают без действия пользователя.', { cls: motion.cls, shifts: motion.shifts?.slice(-12) });
  } catch (e) {
    fatal = String(e?.stack || e).slice(0, 4000);
    addIssue(issues, 'CRITICAL', 'AUTOPILOT_FATAL', 'Автопилот не смог завершить сценарий', 'Прогон оборвался на конкретной ошибке; это сохранено как баг вместо молчаливого зависания.', { error: fatal });
  } finally {
    if (consoleErrors.length) addIssue(issues, 'HIGH', 'CONSOLE_ERRORS', `Console errors: ${consoleErrors.length}`, 'В production во время пользовательского сценария появились ошибки JavaScript/браузера.', { sample: consoleErrors.slice(0, 8) });
    if (pageErrors.length) addIssue(issues, 'CRITICAL', 'PAGE_ERRORS', `Page exceptions: ${pageErrors.length}`, 'Необработанные JavaScript-исключения могут ломать экран или действие.', { sample: pageErrors.slice(0, 8) });
    if (requestFailures.length) addIssue(issues, 'MEDIUM', 'REQUEST_FAILURES', `Failed requests: ${requestFailures.length}`, 'Некоторые сетевые запросы не завершились успешно.', { sample: requestFailures.slice(0, 10) });
    if (http5xx.length) addIssue(issues, 'HIGH', 'HTTP_5XX', `HTTP 5xx: ${http5xx.length}`, 'Backend вернул серверную ошибку во время пользовательского сценария.', { sample: http5xx.slice(0, 10) });
    const report = { run_id: RUN_ID, project, url: page.url(), release, duration_ms: Date.now() - started, issues, screens, console_errors: consoleErrors, page_errors: pageErrors, request_failures: requestFailures, http_5xx: http5xx, fatal };
    writeReport(project, report);
  }

  const blockers = issues.filter(x => x.severity === 'CRITICAL' || x.severity === 'HIGH');
  expect(blockers, `${blockers.length} HIGH/CRITICAL issues; inspect artifacts`).toHaveLength(0);
});
