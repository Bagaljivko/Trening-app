#!/usr/bin/env node
// End-to-end checks for the Training log, run in headless Chromium.
//
//   npm install --no-save playwright@1.63.0 && npx playwright install chromium
//   node tests/app.test.js
//
// Starts its own static server for the repo, so no other setup is needed.
// Exits with code 1 if any check fails. GitHub Actions runs it on every push.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const WIDTHS = [[320, 568], [375, 667], [430, 932]];
const day = n => new Date(Date.now() - n * 864e5).toISOString();
const hrs = n => new Date(Date.now() - n * 3600e3).toISOString();

let failed = 0, passed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; return; }
  failed++; console.log(`  FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
      if (p === "/sw.js" && serve.swOverride) { rsp.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }); return rsp.end(serve.swOverride); }
      const f = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, () => res(srv));
  });
}

const baseSeed = extra => Object.assign({ sessions: [], plan: null, settings: { count: 7, mute: true, lastExport: Date.now() }, custom: [], updated: 0, profile: {}, weighins: [] }, extra);

async function open(browser, url, seed, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.w || 375, height: opts.h || 667 }, colorScheme: opts.scheme || "dark",
    serviceWorkers: "block", acceptDownloads: true, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(url);
  if (seed) { await page.evaluate(s => localStorage.setItem("training-log-v1", JSON.stringify(s)), seed); await page.reload(); }
  return { ctx, page };
}
// Opens Settings with the gear (or stays there if the app already reopened on it)
const toSettings = async page => { if (!(await page.$('[data-act="setclose"]'))) await page.click('[data-act="settings"]'); };
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("training-log-v1")));
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

(async () => {
  const srv = await serve();
  const URL = `http://localhost:${srv.address().port}/index.html`;
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- layout on phones, both themes
  console.log("layout at 320 / 375 / 430 px, dark and light");
  const busy = baseSeed({
    sessions: Array.from({ length: 6 }, (_, k) => ({ id: "s" + k, date: day(30 - k * 5), v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8 }] }, { ex: 7, sets: [{ w: 45, r: 0 }] }] })),
    plan: { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 102.5, r: 8, done: false }, { w: 102.5, r: 8, done: false }] }, { ex: 7, sets: [{ w: 45, r: "", done: false }, { w: 45, r: "", done: false }] }, { ex: "ng-push-up", sets: [{ w: 0, r: 10, done: false }] }] },
    profile: { name: "Test", startW: 90, goalW: 82 }, weighins: [{ id: "w", date: day(9).slice(0, 10), w: 88 }],
  });
  for (const [w, h] of WIDTHS) for (const scheme of ["dark", "light"]) {
    const tag = `${w}px ${scheme}`;
    const { ctx, page } = await open(browser, URL, busy, { w, h, scheme });
    for (const t of ["today", "exercises", "history", "body"]) {
      await page.click(`[data-tab="${t}"]`);
      check(`${tag}: ${t} has no sideways scroll`, await noOverflow(page));
    }
    await page.click('[data-tab="today"]');
    await page.click('[data-act="open"][data-i="0"]');
    check(`${tag}: weight and reps cards fit`, await page.evaluate(() => [...document.querySelectorAll(".num input")].every(i => i.scrollWidth <= i.clientWidth + 1)));
    const ill = await page.evaluate(() => { const el = document.querySelector(".fpic"); const n = el.querySelector(".ill-s-near"); return { bg: getComputedStyle(el).backgroundColor, near: n && getComputedStyle(n).stroke }; });
    check(`${tag}: illustration has no card`, ill.bg === "rgba(0, 0, 0, 0)", ill.bg);
    check(`${tag}: figure colour follows the theme`, ill.near === (scheme === "dark" ? "rgb(245, 245, 247)" : "rgb(17, 17, 20)"), ill.near);
    await page.evaluate(() => openFocus(1));
    await page.click('[data-act="hold"]');
    await page.waitForTimeout(300);
    const pop = await page.evaluate(() => { const o = document.querySelector(".hov"); return { fits: o.scrollHeight <= o.clientHeight, done: getComputedStyle(document.querySelector(".hold-done")).color }; });
    check(`${tag}: hold pop-up fits without scrolling`, pop.fits);
    check(`${tag}: Done early text is white`, pop.done === "rgb(255, 255, 255)", pop.done);
    check(`${tag}: no page errors`, page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- zoom and inputs
  console.log("zoom and inputs");
  {
    const { ctx, page } = await open(browser, URL, busy, { mobile: true });
    const meta = await page.getAttribute('meta[name="viewport"]', "content");
    check("viewport blocks zoom", /maximum-scale=1/.test(meta) && /user-scalable=no/.test(meta), meta);
    check("pinch gesture events are blocked", await page.evaluate(() => ["gesturestart", "gesturechange", "gestureend"].every(t => { const e = new Event(t, { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })));
    check("pinch and double-tap zoom are off (scrolling only)", await page.evaluate(() => getComputedStyle(document.body).touchAction === "pan-x pan-y" && getComputedStyle(document.querySelector(".nav button")).touchAction === "pan-x pan-y"));
    const tm = await page.evaluate(() => {
      const mk = n => { const el = document.querySelector("main"); const ts = Array.from({ length: n }, (_, i) => new Touch({ identifier: i, target: el, clientX: 100 + i * 50, clientY: 200 }));
        const e = new TouchEvent("touchmove", { touches: ts, targetTouches: ts, changedTouches: ts, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
      return { one: mk(1), two: mk(2) };
    });
    check("two-finger moves are cancelled, one-finger scrolling is not", tm.two === true && tm.one === false, JSON.stringify(tm));
    check("long-press on buttons doesn't select text", await page.evaluate(() => getComputedStyle(document.querySelector(".nav button")).userSelect === "none"));
    await page.click('[data-tab="body"]'); await page.click('.dock [data-act="weighin"]');
    const small = await page.evaluate(() => [...document.querySelectorAll("input:not([type=file])")].filter(i => i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16).length);
    check("form inputs are 16px or larger", small === 0, small + " smaller");
    await ctx.close();
  }

  // ---------------------------------------------------------------- native app feel
  console.log("native app feel");
  {
    const { ctx, page } = await open(browser, URL, busy, { mobile: true });
    const sel = await page.evaluate(() => ["h1", "main p", ".row", ".nav span", "main"].map(s => document.querySelector(s)).filter(Boolean).map(el => getComputedStyle(el).userSelect));
    check("no text can be selected anywhere", sel.length >= 3 && sel.every(v => v === "none"), sel.join(","));
    const cm = await page.evaluate(() => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.querySelector("main").dispatchEvent(e); return e.defaultPrevented; });
    check("long-press never opens the browser menu", cm);
    check("the app frame never bounces", await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY === "none" && getComputedStyle(document.documentElement).webkitTextSizeAdjust === "100%"));
    const tc = await page.$$eval('meta[name="theme-color"]', ms => ms.map(m => m.media + "=" + m.content).join("|"));
    check("status bar colour follows light and dark mode", /light\)=#F5F5F7/.test(tc) && /dark\)=#000000/.test(tc), tc);
    const imgs = await page.$$eval('link[rel="apple-touch-startup-image"]', ls => ls.map(l => l.getAttribute("href")));
    const missing = imgs.filter(h => !fs.existsSync(path.join(ROOT, h)));
    check("iPhone launch screens exist for light and dark", imgs.length === 26 && missing.length === 0, missing.join(","));

    // Android back: a sheet closes first, then the tab returns to Today; the app stays open
    await page.click('[data-tab="exercises"]'); await page.click('[data-act="detail"]');
    check("an open sheet locks the screen behind it", await page.evaluate(() => document.documentElement.classList.contains("locked") && getComputedStyle(document.body).overflowY === "hidden"));
    const bd = await page.evaluate(() => { const bg = document.querySelector(".sheet-bg"); const tch = new Touch({ identifier: 1, target: bg, clientX: 20, clientY: 40 });
      const e = new TouchEvent("touchmove", { touches: [tch], targetTouches: [tch], changedTouches: [tch], bubbles: true, cancelable: true }); bg.dispatchEvent(e); return e.defaultPrevented; });
    check("dragging the dimmed area doesn't scroll the screen behind", bd);
    await page.goBack(); await page.waitForTimeout(150);
    check("Back closes the sheet first", !(await page.$(".sheet")) && (await page.evaluate(() => tab)) === "exercises");
    await page.goBack(); await page.waitForTimeout(150);
    check("Back then returns to Today", (await page.evaluate(() => tab)) === "today" && !!(await page.$('[data-tab="today"][aria-current="page"]')));
    // closing with the X and then Back needs only one press to reach Today
    await page.click('[data-tab="history"]'); await page.click('[data-tab="body"]'); await page.click('[data-tab="today"]');
    await page.waitForTimeout(150);
    check("no leftover Back steps after returning to Today", await page.evaluate(() => !backGuard));

    // Back from the exercise screen keeps the logged set
    await page.click('[data-act="open"][data-i="0"]');
    await page.evaluate(() => { window.__vib = []; navigator.vibrate = p => { window.__vib.push(p); return true; }; });
    await page.click('#ctaBox [data-act="done"]');
    check("a logged set gives a short vibration", (await page.evaluate(() => window.__vib)).includes(35));
    await page.goBack(); await page.waitForTimeout(150);
    check("Back leaves the exercise screen and keeps the set", (await page.evaluate(() => !focus && tab === "today")) && (await stored(page)).plan.items[0].sets[0].done === true);

    // drag a sheet down to close it; a short drag springs back
    const drag = dist => page.evaluate(async d => {
      const h = document.querySelector(".sheet-h"); const pt = y => new Touch({ identifier: 7, target: h, clientX: 150, clientY: y });
      const fire = (type, y) => { const tt = type === "touchend" ? [] : [pt(y)]; h.dispatchEvent(new TouchEvent(type, { touches: tt, targetTouches: tt, changedTouches: [pt(y)], bubbles: true, cancelable: true })); };
      fire("touchstart", 300); for (let y = 300; y <= 300 + d; y += 20) { fire("touchmove", y); await new Promise(r => setTimeout(r, 30)); } fire("touchend", 300 + d);
      await new Promise(r => setTimeout(r, 350)); return !!document.querySelector(".sheet");
    }, dist);
    await page.click('[data-tab="exercises"]'); await page.click('[data-act="detail"]');
    check("a short drag down leaves the sheet open", await drag(40));
    check("dragging a sheet down closes it", !(await drag(220)));
    check("closing by drag leaves no extra Back step", await page.evaluate(() => { history.back(); return true; }) && (await page.waitForTimeout(200), (await page.evaluate(() => tab)) === "today"));
    check("native feel: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- screen stays awake for the whole workout
  console.log("screen awake for the whole workout");
  {
    const { ctx, page } = await open(browser, URL, busy, { mobile: true });
    await page.evaluate(() => {
      window.__wake = { on: 0, requests: 0 };
      Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => {
        window.__wake.requests++; window.__wake.on++; const l = new EventTarget(); let done = false;
        l.release = async () => { if (done) return; done = true; window.__wake.on--; l.dispatchEvent(new Event("release")); }; return l; } } });
      releaseWake(); wakeLock = null; render();
    });
    const awake = async () => { await page.waitForTimeout(80); return page.evaluate(() => window.__wake.on); };
    check("screen may sleep before the workout starts", (await awake()) === 0);
    await page.click('[data-act="open"][data-i="0"]');
    check("screen stays awake on the exercise screen", (await awake()) === 1);
    await page.click('#ctaBox [data-act="done"]'); await page.click('[data-act="restskip"]');
    check("screen stays awake after rest is skipped", (await awake()) === 1);
    await page.click('[data-act="back"]');
    check("screen stays awake on Today while a workout is in progress", (await awake()) === 1);
    await page.click('[data-tab="history"]'); await page.click('[data-tab="today"]');
    check("only one wake lock is ever held", (await page.evaluate(() => window.__wake.requests)) === 1, String(await page.evaluate(() => window.__wake.requests)));
    await page.click('[data-act="discard"]');
    check("screen may sleep again once the workout ends", (await awake()) === 0);
    check("wake lock: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- settings screen, notes, favourites, edit, CSV
  console.log("settings, notes, favourites, editing, CSV");
  {
    const { ctx, page } = await open(browser, URL, busy, { mobile: true });
    // offline cache never answers for Google; the font comes with the app
    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    check("offline cache only keeps the app's own files (Drive always live)", /origin !== self\.location\.origin\) return/.test(sw));
    check("font is bundled with the app", !(await page.$('link[href*="fonts.googleapis"]')) && fs.existsSync(path.join(ROOT, "fonts/inter-latin.woff2")) && sw.includes("fonts/inter-latin.woff2")
      && await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("16px Inter"); }));
    // gear opens Settings from every tab; close returns to where you were
    for (const tb of ["today", "exercises", "history", "body"]) {
      await page.click(`[data-tab="${tb}"]`); await page.click('[data-act="settings"]');
      const ok = await page.evaluate(() => tab === "settings" && /Settings/.test(document.querySelector("h1").textContent));
      await page.click('[data-act="setclose"]');
      check(`${tb}: gear opens Settings and closing returns`, ok && (await page.evaluate(() => tab)) === tb);
    }
    await page.click('[data-tab="history"]');
    check("History no longer holds the settings", !(await page.$('[data-act="export"]')) && !(await page.$('[data-act="cnt"]')));
    await page.click('[data-act="settings"]');
    for (const a of ["cnt", "goal", "restset", "mute", "prefs", "export", "exportcsv", "import", "driveconnect", "profile", "chkupd", "shareapp"])
      check(`Settings has ${a}`, !!(await page.$(`[data-act="${a}"]`)));
    await page.goBack(); await page.waitForTimeout(150);
    check("Back from Settings returns to the tab you came from", (await page.evaluate(() => tab)) === "history");
    await page.click('[data-act="settings"]');
    const m0 = await page.evaluate(() => S.settings.mute); await page.click('[data-act="mute"]');
    check("Sound switch works in Settings", (await stored(page)).settings.mute === !m0);

    // CSV: one row per set, Excel-friendly
    const csv = await page.evaluate(() => csvData());
    const lines = csv.replace(/^﻿/, "").trim().split(/\r\n/);
    const sets = busy.sessions.reduce((n, s) => n + s.items.reduce((m, it) => m + it.sets.length, 0), 0);
    check("CSV has a header and one row per logged set", lines[0].startsWith("Date,Time,Workout,Exercise") && lines.length === sets + 1, lines.length + " lines");
    check("CSV starts with a BOM so Excel reads it", csv.charCodeAt(0) === 0xfeff);
    const [csvDl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exportcsv"]')]);
    check("CSV downloads as a .csv file", /\.csv$/.test(csvDl.suggestedFilename()));

    // favourites and never suggest
    await page.click('[data-act="setclose"]'); await page.click('[data-tab="exercises"]');
    await page.click('[data-act="detail"][data-id="0"]'); await page.click('[data-act="pref"][data-v="never"]');
    check("Never suggest is saved", (await stored(page)).settings.exPref["0"] === "never");
    const shuffles = () => page.evaluate(() => { const plan = S.plan, ss = S.sessions; S.sessions = []; let n = 0; for (let k = 0; k < 100; k++) { generate(); n += S.plan.items.filter(it => it.ex === 0).length; } S.sessions = ss; S.plan = plan; persistPlan(); return n; });
    const picks = await shuffles();
    check("a never-suggested exercise is left out of shuffles", picks === 0, picks + " picks");
    await page.click('[data-act="pref"][data-v="fav"]');
    const favPicks = await shuffles();
    check("a favourite comes up much more often in shuffles", favPicks >= 45, favPicks + " of 100 (about 25 without)");
    await page.click('.sheet [data-act="close"].iconbtn');
    check("favourite is marked in the list", /Favourite/.test(await page.textContent('[data-act="detail"][data-id="0"]')));

    // notes
    await page.click('[data-act="detail"][data-id="0"]'); await page.click('.sheet [data-act="note"]');
    await page.fill("#note-t", "Bench 3, wide grip"); await page.click('[data-act="notesave"]');
    check("a note is saved and the exercise sheet comes back", (await stored(page)).settings.notes["0"] === "Bench 3, wide grip" && !!(await page.$('.sheet [data-act="pref"]')));
    await page.click('.sheet [data-act="close"].iconbtn'); await page.click('[data-tab="today"]');
    await page.click('[data-act="open"][data-i="0"]');
    check("the note shows on the exercise screen", /Bench 3, wide grip/.test(await page.textContent("main")));
    await page.click('[data-act="back"]');

    // edit a past workout: change kg, remove a set; a safety copy is made first
    await page.click('[data-tab="history"]'); await page.click(".hrow");
    const sid = await page.evaluate(() => sheet.id);
    await page.click('[data-act="editsess"]');
    await page.fill("#es-0-0-w", "65"); await page.fill("#es-0-0-r", "10");
    await page.click('.esrow[data-i="1"][data-j="0"] [data-act="esdel"]');
    await page.click('[data-act="essave"]'); await page.waitForTimeout(300);
    const es = (await stored(page)).sessions.find(s => s.id === sid);
    check("editing a workout saves the new numbers", es.items[0].sets[0].w === 65 && es.items[0].sets[0].r === 10, JSON.stringify(es.items[0].sets[0]));
    check("a removed set's exercise goes when it had no sets left", es.items.length === 1 && !!es.edited);
    check("the edited workout's summary is rebuilt", !!es.summary && Array.isArray(es.summary.prs));
    check("all other workouts are untouched", (await stored(page)).sessions.filter(s => s.id !== sid).every(s => JSON.stringify(s.items) === JSON.stringify(busy.sessions.find(b => b.id === s.id).items)));
    const snaps = await page.evaluate(async () => (await snapList()).map(x => x.reason));
    check("a safety copy is made before editing", snaps.includes("edit"), snaps.join(","));
    check("after saving, the summary is shown again", (await page.evaluate(() => sheet && sheet.type)) === "summary");

    // restore keeps local notes and favourites and adds the backup's
    await page.evaluate(async () => { const v = backupData(); v.settings = Object.assign({}, v.settings, { notes: { "7": "from backup", "0": "old" }, exPref: { "22": "never" } }); await applyRestore(v); }); await page.waitForTimeout(200);
    const st = (await stored(page)).settings;
    check("restore adds notes and favourites without overwriting yours", st.notes["7"] === "from backup" && st.notes["0"] === "Bench 3, wide grip" && st.exPref["22"] === "never" && st.exPref["0"] === "fav");
    check("settings features: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- language: English / Serbian
  console.log("language: English and Serbian");
  {
    const { ctx, page } = await open(browser, URL, busy, { mobile: true, w: 320, h: 568 });
    const before = JSON.stringify((await stored(page)).sessions);
    check("the app starts in English", (await page.evaluate(() => LANG)) === "en" && (await page.textContent('[data-tab="today"]')).includes("Today"));
    await page.click('[data-act="settings"]');
    check("Settings has English and Srpski", !!(await page.$('[data-act="lang"][data-v="en"].on')) && !!(await page.$('[data-act="lang"][data-v="sr"]')));
    await page.click('[data-act="lang"][data-v="sr"]');
    check("switching to Serbian changes the screen at once", /Podešavanja/.test(await page.textContent("h1")) && (await page.textContent('[data-tab="today"]')).includes("Danas") && (await page.getAttribute("html", "lang")) === "sr-Latn");
    check("language choice is saved", (await stored(page)).settings.lang === "sr");
    await page.reload();
    check("Serbian is kept after reopening the app", (await page.textContent('[data-tab="history"]')).includes("Istorija"));
    const plu = await page.evaluate(() => [plu(1, "workout"), plu(3, "workout"), plu(5, "workout"), plu(21, "workout"), plu(12, "workout"), plu(2, "exercise"), plu(7, "exercise"), plu(22, "set")].join(","));
    check("Serbian plurals are right", plu === "trening,treninga,treninga,trening,treninga,vežbe,vežbi,serije", plu);
    check("every exercise has a Serbian description", await page.evaluate(() => allExercises().every(e => !e.desc || (SR_DESC[String(e.id)] && exDesc(e) !== e.desc))));
    check("exercise names stay in English", await page.evaluate(() => exById(0).name === "Bench press"));
    check("dates are written in Serbian", /novembar|decembar|januar|februar|mart|april|maj|jun|jul|avgust|septembar|oktobar/.test(await page.evaluate(() => longDate())));
    for (const tb of ["today", "exercises", "history", "body"]) {
      await page.click(`[data-tab="${tb}"]`);
      const body = await page.evaluate(() => document.querySelector("main").innerText + document.querySelector(".nav").innerText);
      check(`Serbian ${tb}: no broken text or sideways scroll at 320 px`, !/\$\{|\{[a-z]+\}|undefined|NaN/.test(body) && await noOverflow(page));
    }
    await page.click('[data-tab="today"]'); await page.click('[data-act="open"][data-i="0"]');
    check("Serbian exercise screen", /Gotovo, serija 1/.test(await page.textContent("#ctaBox")) && await noOverflow(page));
    await page.evaluate(() => { S.plan.items.forEach((it, n) => it.sets.forEach((x, k) => { x.done = !(n === S.plan.items.length - 1 && k === it.sets.length - 1); })); focus.i = S.plan.items.length - 1; selSet = null; persistPlan(); render(); });
    await page.click('#ctaBox [data-act="done"]'); await page.waitForTimeout(200);
    check("in Serbian the last set also saves the workout", await page.evaluate(() => S.plan === null && S.sessions.length === 7));
    await page.evaluate(() => undoLast()); await page.waitForTimeout(200);
    check("undo brings the workout back", await page.evaluate(() => !!S.plan && S.sessions.length === 6 && !!focus));
    await page.click('[data-act="back"]'); await page.click('[data-act="settings"]'); await page.click('[data-act="lang"][data-v="en"]');
    check("switching back to English works", /Settings/.test(await page.textContent("h1")) && (await stored(page)).settings.lang === "en");
    check("switching language never changes the workouts", JSON.stringify((await stored(page)).sessions) === before);
    check("language: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- full-screen rest alert
  console.log("full-screen rest alert");
  for (const [w, h] of WIDTHS) {
    const { ctx, page } = await open(browser, URL, baseSeed({ plan: { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 70, r: 8, done: false }, { w: 70, r: 8, done: false }] }, { ex: 7, sets: [{ w: 30, r: "", done: false }] }] } }), { mobile: true, w, h });
    await page.evaluate(() => { S.settings.mute = false; window.__dings = 0; ding = () => { window.__dings++; }; });
    await page.click('[data-act="open"][data-i="0"]'); await page.click('#ctaBox [data-act="done"]');
    check(`${w}px: no alert while more than 10 s of rest are left`, !(await page.$(".rov-bg")));
    await page.evaluate(() => { rest.end = Date.now() + 8000; }); await page.waitForTimeout(400);
    check(`${w}px: last 10 s of rest show full screen with the next set`, !!(await page.$(".rov-bg")) && /Set 2 of 2/.test(await page.textContent(".rov")) && /Start set 2/.test(await page.textContent(".rov-go")));
    check(`${w}px: rest alert fits the screen`, await page.evaluate(() => { const o = document.querySelector(".rov"), b = o.getBoundingClientRect().bottom; return [...o.children].every(c => c.getBoundingClientRect().bottom <= b + 1); }) && await noOverflow(page));
    await page.click(".rov-30"); await page.waitForTimeout(250);
    check(`${w}px: +30 s adds time and hides the alert until the last 10 s`, !(await page.$(".rov-bg")) && await page.evaluate(() => rest.end - Date.now() > 30000));
    await page.evaluate(() => { rest.end = Date.now() - 50; }); await page.waitForTimeout(500);
    await page.evaluate(() => { rest.beep = 0; }); await page.waitForTimeout(400);
    const d = await page.evaluate(() => window.__dings);
    check(`${w}px: when rest is over it keeps beeping until you start`, !!(await page.$(".rov-bg.over")) && d >= 2, d + " beeps");
    await page.evaluate(() => { rest.beep = Date.now() - 6000; rest.end = Date.now() - 130000; window.__dings = 0; }); await page.waitForTimeout(400);
    check(`${w}px: the alert goes quiet after 2 minutes`, (await page.evaluate(() => window.__dings)) === 0);
    await page.click(".rov-go"); await page.waitForTimeout(250);
    check(`${w}px: Start set stops the alert and opens that set without logging it`, !(await page.$(".rov-bg")) && await page.evaluate(() => rest === null && focus.i === 0 && selSet === 1 && S.plan.items[0].sets[1].done === false));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, URL, baseSeed({ plan: { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 70, r: 8, done: false }] }, { ex: 7, sets: [{ w: 30, r: "", done: false }] }] } }), { mobile: true });
    await page.click('[data-act="open"][data-i="0"]'); await page.click('#ctaBox [data-act="done"]');
    await page.click('[data-act="back"]'); await page.click('[data-tab="history"]');
    await page.evaluate(() => { rest.end = Date.now() - 50; }); await page.waitForTimeout(500);
    check("the alert shows on any tab and names the next exercise", !!(await page.$(".rov-bg")) && /Next exercise/.test(await page.textContent(".rov")) && /Start hold/.test(await page.textContent(".rov-go")));
    await page.goBack(); await page.waitForTimeout(250);
    check("Back closes the alert and goes to the next exercise", !(await page.$(".rov-bg")) && await page.evaluate(() => rest === null && focus && focus.i === 1));
    await page.click('[data-act="back"]'); await page.click('[data-act="settings"]'); await page.click('[data-act="restalert"]');
    check("the full-screen alert can be switched off in Settings", (await stored(page)).settings.restAlert === false);
    await page.click('[data-act="setclose"]'); await page.evaluate(() => openFocus(1));
    await page.evaluate(() => { startRest(60000, 1); rest.end = Date.now() + 5000; }); await page.waitForTimeout(400);
    check("with the switch off, no full-screen alert", !(await page.$(".rov-bg")));
    check("rest alert: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- adding an exercise mid-workout
  console.log("adding an exercise mid-workout");
  {
    const hist = [];
    for (let k = 0; k < 4; k++) hist.push({ id: "h" + k, date: day(40 - k * 5), v: 2, items: [{ ex: 1, sets: [{ w: 100, r: 5 }] }] });
    hist.push({ id: "hc", date: day(1), v: 2, items: [{ ex: 0, sets: [{ w: 70, r: 8 }] }] });
    const plan = { created: "", v: 2, items: [{ ex: 9, sets: [{ w: 12, r: 10, done: true }, { w: 12, r: 10, done: false }] }, { ex: 3, sets: [{ w: 20, r: 10, done: false }] }] };
    for (const [w, h] of WIDTHS) {
      const { ctx, page } = await open(browser, URL, baseSeed({ sessions: hist, plan }), { mobile: true, w, h });
      await page.click('[data-act="open"][data-i="0"]');
      await page.click(".ftop .fadd");
      check(`${w}px: + on the exercise screen opens the muscle groups`, (await page.$$(".pg")).length === 7 && !!(await page.$(".pg.hl")));
      check(`${w}px: groups show when they were last trained`, /trained yesterday/.test(await page.textContent('.pg[data-g="chest"]')) && /in today's workout/.test(await page.textContent('.pg[data-g="shoulders"]')));
      await page.click('.pg[data-g="back"]');
      const sugg = await page.$$eval(".psugg .prow", x => x.map(e => e.innerText));
      check(`${w}px: up to 3 suggestions, each with a reason`, sugg.length >= 1 && sugg.length <= 3 && sugg.every(s => /\n/.test(s.trim())), JSON.stringify(sugg));
      check(`${w}px: list sorts by longest ago, with a switch to most done`, !!(await page.$('[data-act="picksort"][data-v="ago"].on')) && !!(await page.$('[data-act="picksort"][data-v="most"]')));
      check(`${w}px: picker has no sideways scroll`, await noOverflow(page));
      await page.click(".psugg .prow");
      const st = await page.evaluate(() => ({ n: S.plan.items.length, at: focus.i, first: S.plan.items[0].ex, done: S.plan.items[0].sets[0].done }));
      check(`${w}px: added right after the current exercise and opened`, st.n === 3 && st.at === 1 && st.first === 9 && st.done === true, JSON.stringify(st));
      await ctx.close();
    }
    const { ctx, page } = await open(browser, URL, baseSeed({ sessions: hist, plan: { created: "", v: 2, items: [{ ex: 9, sets: [{ w: 12, r: 10, done: false }] }] } }), { mobile: true, w: 320, h: 568 });
    await page.click('[data-act="open"][data-i="0"]');
    check("the last set's Finish workout has a quiet 'add one more' link under it", /Finish workout/.test(await page.textContent("#ctaBox .cta")) && (await page.textContent("#ctaBox .addmore")) === "Not yet — add one more exercise");
    await page.evaluate(() => { S.plan.items[0].sets[0].done = true; persistPlan(); rest = null; render(); });
    check("end of workout asks 'Had enough?' with Finish as the main button", /Had enough\?/.test(await page.textContent(".upnext.done")) && /Finish workout/.test(await page.textContent("#ctaBox .cta")));
    check("a quiet 'add one more' link sits under Finish", (await page.textContent("#ctaBox .addmore")) === "Not yet — add one more exercise" && await page.evaluate(() => document.querySelector("#ctaBox .addmore").getBoundingClientRect().bottom <= innerHeight));
    await page.click("#ctaBox .addmore");
    check("'add one more' opens the picker", /One more exercise/.test(await page.textContent(".sheet-h h2")));
    await page.click('.pg[data-g="back"]'); await page.click(".list:not(.psugg) .prow");
    check("one more exercise goes at the end and the workout isn't finished", await page.evaluate(() => S.plan && S.plan.items.length === 2 && focus.i === 1 && !S.plan.items[1].sets.some(s => s.done)));
    await page.click('[data-act="back"]');
    check("Today offers the same link once everything is done", !(await page.$('.list-foot [data-act="addmore"]')));
    check("add exercise: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- keep going from the summary
  console.log("keep going from the summary");
  for (const [w, h] of WIDTHS) {
    const hist = [{ id: "old", date: day(3), v: 2, items: [{ ex: 1, sets: [{ w: 100, r: 5 }] }] }];
    const { ctx, page } = await open(browser, URL, baseSeed({ sessions: hist, plan: { created: "", v: 2, items: [{ ex: 9, sets: [{ w: 12, r: 10, done: false }] }] } }), { mobile: true, w, h });
    await page.click('[data-act="open"][data-i="0"]');
    check(`${w}px: 'add one more' is still under the last set's Finish workout`, !!(await page.$('#ctaBox [data-act="addmore"]')));
    await page.click('#ctaBox [data-act="done"]'); await page.waitForTimeout(250);
    check(`${w}px: the summary right after finishing offers Keep going`, !!(await page.$('.sheet [data-act="keepgoing"]')) && (await stored(page)).sessions.length === 2);
    check(`${w}px: summary with Keep going has no sideways scroll`, await noOverflow(page));
    await page.click('.sheet [data-act="keepgoing"]'); await page.waitForTimeout(200);
    const s1 = await stored(page);
    check(`${w}px: Keep going reopens the workout and opens the picker`, s1.sessions.length === 1 && !!s1.plan && s1.plan.items[0].sets[0].done === true && /One more exercise/.test(await page.textContent(".sheet-h h2")));
    await page.click('.pg[data-g="back"]'); await page.click(".list:not(.psugg) .prow");
    check(`${w}px: the extra exercise goes at the end of the reopened workout`, await page.evaluate(() => S.plan.items.length === 2 && focus.i === 1 && S.plan.items[0].sets[0].done));
    await page.evaluate(() => { S.plan.items[1].sets.forEach(s => { s.done = true; }); persistPlan(); finish(); }); await page.waitForTimeout(200);
    const s2 = await stored(page);
    check(`${w}px: finishing again saves it once, with both exercises`, s2.sessions.length === 2 && s2.sessions[1].items.length === 2 && !s2.plan);
    check(`${w}px: older summaries in History don't offer Keep going`, await page.evaluate(() => { sheet = { type: "summary", id: "old" }; render(); return !document.querySelector('[data-act="keepgoing"]'); }));
    check(`${w}px: keep going: no page errors`, page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- cool-down stretch and core after the workout
  console.log("cool-down stretch and core after the workout");
  for (const [w, h] of WIDTHS) {
    const { ctx, page } = await open(browser, URL, baseSeed({ sessions: [{ id: "old", date: day(6), v: 2, items: [{ ex: 7, sets: [{ w: 45, r: "" }] }] }],
      plan: { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 70, r: 8, done: true }, { w: 70, r: 8, done: false }] }] } }), { mobile: true, w, h });
    await page.click('[data-act="open"][data-i="0"]'); await page.click('#ctaBox [data-act="done"]'); await page.waitForTimeout(250);
    check(`${w}px: summary offers a cool-down stretch and core (no core today)`, !!(await page.$('.sheet [data-act="stretchgo"]')) && !!(await page.$('.sheet [data-act="corego"]')));
    check(`${w}px: first time both cards are quiet, below the summary`, (await page.$$(".sheet .nudge.lv0")).length === 2 && await noOverflow(page));
    await page.click('[data-act="stretchgo"]'); await page.waitForTimeout(250);
    check(`${w}px: the stretch player shows 4 stretches with a picture and fits`, /of 4/.test(await page.textContent(".stv .hov-set")) && !!(await page.$(".stv .ill svg")) && await page.evaluate(() => { const o = document.querySelector(".stv"), b = o.getBoundingClientRect().bottom; return [...o.children].every(c => c.getBoundingClientRect().bottom <= b + 1); }));
    check(`${w}px: stretches are not logged as sets`, (await stored(page)).sessions.slice(-1)[0].items.length === 1);
    for (let k = 0; k < 10 && await page.$(".stv"); k++) { await page.evaluate(() => { stretch.end = Date.now() - 10; }); await page.waitForTimeout(320); }
    check(`${w}px: finishing the stretch marks the workout stretched`, await page.evaluate(() => !stretch && S.sessions[S.sessions.length - 1].stretched === true) && !!(await page.$(".sheet .nudge.done")));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, URL, baseSeed({ sessions: [{ id: "old", date: day(6), v: 2, items: [{ ex: 7, sets: [{ w: 45, r: "" }] }] }] }), { mobile: true });
    const levels = [];
    for (let n = 0; n < 5; n++) {
      await page.evaluate(() => { sheet = null; S.plan = { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 70, r: 8, done: true }] }] }; finish(); });
      levels.push(await page.evaluate(() => [...document.querySelectorAll(".sheet .nudge")].map(e => (e.className.match(/lv\d/) || [""])[0]).sort().join("")));
    }
    check("skipping makes the offers stronger: quiet, then Recommended, then Highly recommended", levels.join(" ") === "lv0lv0 lv0lv0 lv1lv1 lv1lv1 lv2lv2", levels.join(" "));
    check("the strongest level says why", /Highly recommended/i.test(await page.textContent(".sheet")) && /No stretching in your last 4 workouts/.test(await page.textContent(".sheet")));
    await page.click('[data-act="nudgeskip"][data-k="st"]');
    check("Not today hides the card for this workout", !(await page.$('.sheet [data-act="stretchgo"]')));
    await page.click('[data-act="corego"]');
    check("Add a core exercise opens the picker on Abs", /Abs/.test(await page.textContent(".sheet-h h2")) && (await page.$$(".prow")).length > 0);
    await page.click(".list:not(.psugg) .prow");
    await page.evaluate(() => { S.plan.items.forEach(it => it.sets.forEach(s => { s.done = true; })); finish(); });
    check("with core done today the core card is gone and its count resets", !(await page.$('[data-act="corego"]')) && (await stored(page)).settings.nudge.core.skips === 0);
    check("cool-down: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- animated exercise pictures
  console.log("animated exercise pictures");
  {
    const { ctx, page } = await open(browser, URL, baseSeed({ plan: { created: "", v: 2, items: [{ ex: 39, sets: [{ w: 80, r: 5, done: false }] }] } }), { mobile: true });
    const files = await page.evaluate(async () => {
      const ex = allExercises().filter(e => typeof e.id === "number" || NGMAP[e.id]);
      let ok = 0; const bad = [];
      for (const e of ex) { const a = await (await fetch(animOf(e))).text(), s = await (await fetch(imgOf(e))).text();
        if (/<animate /.test(a) && !/<animate /.test(s) && a.includes(e.name.replace(/&/g, "&amp;"))) ok++; else bad.push(e.name); }
      return { n: ex.length, ok, bad };
    });
    check("every exercise has an animated picture and an unchanged static one", files.ok === files.n && files.n >= 140, JSON.stringify(files.bad));
    await page.click('[data-act="open"][data-i="0"]');
    check("collapsed: the static picture, nothing moves", !(await page.$(".fpic .ill[data-anim]")) && !(await page.$(".fpic svg animate")));
    await page.click('[data-act="howtoggle"]'); await page.waitForTimeout(400);
    const poses = await page.evaluate(async () => { const s = document.querySelector(".fpic svg"), seen = new Set(); for (let k = 0; k < 5; k++) { seen.add(s.innerHTML); await new Promise(r => setTimeout(r, 170)); } return seen.size; });
    check("expanded: the picture animates", poses >= 3, poses + " poses");
    await page.click('[data-act="howtoggle"]'); await page.waitForTimeout(200);
    const still = await page.evaluate(async () => { const a = document.querySelector(".fpic svg").innerHTML; await new Promise(r => setTimeout(r, 400)); return a === document.querySelector(".fpic svg").innerHTML && !document.querySelector(".fpic .ill")._anim; });
    check("collapsed again: it stops and the static picture is back", still);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.click('[data-act="howtoggle"]'); await page.waitForTimeout(300);
    check("reduce motion: the static picture stays", !(await page.$(".fpic .ill[data-anim]")) && !(await page.evaluate(() => (document.querySelector(".fpic .ill") || {})._anim)));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.click('[data-act="back"]'); await page.click('[data-tab="exercises"]'); await page.waitForTimeout(300);
    check("lists keep static thumbnails", !(await page.$(".ill[data-anim]")) && !(await page.$("svg animate")));
    const moves = async sel => page.evaluate(async sel => { const w = ms => new Promise(r => setTimeout(r, ms));
      for (let k = 0; k < 60 && !(document.querySelector(sel) || {})._anim; k++) await w(25);
      const s = document.querySelector(sel + " svg"), seen = new Set(); if (!s) return 0; for (let k = 0; k < 5; k++) { seen.add(s.innerHTML); await w(200); } return seen.size; }, sel);
    await page.click('[data-act="detail"][data-id="39"]');
    check("the exercise sheet (explanation always shown) animates", (await moves(".sheet .fpic .ill")) >= 3);
    await page.evaluate(() => { sheet = null; render(); });
    const st = await page.evaluate(() => STRETCHES.every(s => animOf(s) && imgOf(s) !== animOf(s)));
    check("every stretch has an animated picture", st);
    await page.evaluate(() => { S.sessions.push({ id: "z", date: new Date().toISOString(), v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8 }] }] }); startStretch("z"); });
    check("the stretch player animates the stretch", (await moves(".stv .ill")) >= 3);
    await page.evaluate(() => stretchClose());
    check("animated pictures: no page errors", page.errors.length === 0, page.errors.join("; "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- backup
  console.log("backup and restore");
  {
    const { ctx, page } = await open(browser, URL, busy);
    await toSettings(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"]')]);
    const file = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "tl-")), "backup.json");
    await dl.saveAs(file);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    check("export holds workouts, profile and weigh-ins", j.sessions.length === 6 && j.profile.name === "Test" && j.weighins.length === 1);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("training-log-v1")); s.sessions = s.sessions.slice(0, 2); localStorage.setItem("training-log-v1", JSON.stringify(s)); });
    await page.reload(); await toSettings(page);
    await page.setInputFiles("#restore", file);
    await page.waitForSelector('[data-act="dorestore"]');
    check("import asks before changing anything", (await stored(page)).sessions.length === 2);
    await page.click('[data-act="dorestore"]');
    check("import adds the missing workouts", (await stored(page)).sessions.length === 6);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, URL, baseSeed({ sessions: busy.sessions, settings: { count: 7 } }));
    check("backup reminder shows when never exported", /only saved on this phone/.test((await page.textContent(".banner")) || ""));
    await ctx.close();
  }

  // ---------------------------------------------------------------- hints, plateau, PRs, charts
  console.log("hints, plateau, PRs, charts");
  {
    const three = [15, 10, 5].map((d, k) => ({ id: "p" + k, date: day(d), v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8 }] }, { ex: 39, sets: [{ w: 80 + k * 2.5, r: 5 }] }] }));
    const { ctx, page } = await open(browser, URL, baseSeed({ sessions: three, plan: { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }, { ex: 39, sets: [{ w: 85, r: 5, done: false }] }, { ex: 16, sets: [{ w: 100, r: 10, done: false }] }] } }));
    check("plateau nudge after 3 sessions at 60 kg", /Third time at 60 kg.*Try 62\.5 kg/.test(await page.evaluate(() => overloadHint(0).text)));
    check("overload hint suggests weight or reps", await page.evaluate(() => overloadHint(39).text) === "try 87.5 kg or 6 reps");
    await page.evaluate(() => { openFocus(1); S.plan.items[1].sets[0].w = 90; });
    await page.click('#ctaBox [data-act="done"]');
    check("heavier set is a PR", (await stored(page)).plan.items[1].sets[0].pr === "weight");
    await page.evaluate(() => { openFocus(2); });
    await page.click('#ctaBox [data-act="done"]');
    check("first attempt is not a PR", !(await stored(page)).plan.items[2].sets[0].pr);
    await page.evaluate(() => { focus = null; sheet = { type: "detail", id: 0 }; render(); });
    check("progress chart shows for an exercise", !!(await page.$(".sheet .chart svg")));
    await ctx.close();
  }

  // ---------------------------------------------------------------- shuffle and No gym
  console.log("smarter shuffle and No gym");
  {
    const recent = baseSeed({ sessions: [{ id: "r", date: hrs(20), v: 2, items: [0, 3, 47].map(ex => ({ ex, sets: [{ w: 50, r: 8 }] })) }] });
    const { ctx, page } = await open(browser, URL, recent);
    const hits = await page.evaluate(() => { let c = 0; for (let k = 0; k < 20; k++) { generate(); c += S.plan.items.filter(it => ["C", "T"].includes(musclesOf(it.ex)[0])).length; } return c; });
    check("shuffle rests muscles trained in the last 48 h", hits === 0, hits + " chest/triceps picks");
    await page.evaluate(() => { S.plan = null; render(); });
    await page.click('[data-act="nogym"]'); await page.click('[data-act="gen"]');
    const s = await stored(page);
    check("No gym builds only bodyweight exercises", s.plan.nogym && s.plan.items.every(i => String(i.ex).startsWith("ng-")));
    check("No gym keeps each main muscle", await page.evaluate(() => S.plan.items.every((it, k) => musclesOf(it.ex)[0] === musclesOf(S.plan.gymItems[k].ex)[0])));
    const gym = JSON.stringify(s.plan.gymItems.map(i => i.ex));
    await page.click('[data-act="nogym"]');
    check("switching off restores the gym workout", JSON.stringify((await stored(page)).plan.items.map(i => i.ex)) === gym);
    check("every exercise maps to a same-muscle bodyweight one", await page.evaluate(() => SEED.ex.every((e, i) => musclesOf(i)[0] === musclesOf(noGymFor(i, new Set()))[0])));
    await ctx.close();
  }

  // ---------------------------------------------------------------- workout flow, summary, history
  console.log("workout flow, summary, history");
  {
    const old = [{ id: "o1", date: day(6), v: 2, items: [{ ex: 0, sets: [{ w: 55, r: 8 }] }] }];
    const seed = baseSeed({ sessions: old, plan: { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }, { ex: 31, sets: [{ w: 0, r: 10, done: false }] }] } });
    const { ctx, page } = await open(browser, URL, seed);
    await page.click('[data-act="open"][data-i="0"]');
    check("button reads Done, set 1", (await page.textContent("#ctaBox .cta")).trim() === "Done, set 1");
    await page.click('#ctaBox [data-act="done"]');
    check("Done logs the set and starts the rest timer", await page.evaluate(() => S.plan.items[0].sets[0].done && !!rest));
    check("rest is 2 min for a barbell lift", await page.evaluate(() => rest.total === 120000));
    await page.click(".utoast button");
    check("Undo takes the set back", await page.evaluate(() => !S.plan.items[0].sets[0].done && !rest));
    await page.click('#ctaBox [data-act="done"]'); await page.click('#ctaBox [data-act="done"]');
    check("Up next card after the last set", !!(await page.$(".upnext .un-go")));
    await page.click(".un-go");
    check("bodyweight exercise shows reps only", await page.evaluate(() => document.querySelectorAll(".num").length === 1 && !!document.querySelector(".num.reps") && !!document.querySelector(".addkg")));
    check("last set reads Finish workout", (await page.textContent("#ctaBox .cta")).trim() === "Finish workout");
    await page.evaluate(() => { S.plan.started = Date.now() - 50 * 60000; });
    await page.click('#ctaBox [data-act="done"]');
    await page.waitForSelector(".sheet .sm-time");
    const st = await stored(page), last = st.sessions[st.sessions.length - 1];
    check("summary is saved with the workout", last.summary && last.summary.durMin === 50 && Array.isArray(last.summary.recs));
    check("summary leads with the total time", /50 min/.test(await page.textContent(".sm-time")));
    check("existing history is untouched", JSON.stringify(st.sessions[0]) === JSON.stringify(old[0]));
    await page.click('.sheet .cta[data-act="close"]');
    await page.click('[data-tab="history"]');
    const rows = await page.$$eval(".hrow", r => r.map(x => x.innerText.replace(/\s+/g, " ")));
    check("History rows show date and time", /50 min/.test(rows[0]) && /time not recorded/.test(rows[1]), rows.join(" / "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- timed hold and goals
  console.log("timed hold and goals");
  {
    const { ctx, page } = await open(browser, URL, baseSeed({ plan: { created: "", v: 2, items: [{ ex: 7, sets: [{ w: 30, r: "", done: false }, { w: 30, r: "", done: false }] }] } }));
    await page.click('[data-act="open"][data-i="0"]'); await page.click('[data-act="hold"]');
    await page.waitForTimeout(1300); await page.click('[data-act="holdstop"]');
    check("Done early logs the time actually held", await page.evaluate(() => { const s = S.plan.items[0].sets[0]; return s.done && s.w >= 1 && s.w <= 3; }));
    await page.evaluate(() => { S.settings.weekGoal = 5; S.settings.monthGoal = 8; S.plan = null; focus = null; render(); });
    check("weekly goal sets the ring", await page.evaluate(() => document.querySelectorAll(".hero .seg").length === 5 && /\/5/.test(document.querySelector(".hero-n").textContent)));
    check("monthly goal sets the month bar", /of 8/.test(await page.textContent(".month")));
    await ctx.close();
  }

  // ---------------------------------------------------------------- update and share
  console.log("update and share");
  for (const [w, h] of WIDTHS) {
    const { ctx, page } = await open(browser, URL, baseSeed({}), { w, h });
    await toSettings(page);
    check(`${w}px: Check for updates and Share app buttons`, !!(await page.$('[data-act="chkupd"]')) && !!(await page.$('[data-act="shareapp"]')));
    await page.click('[data-act="shareapp"]');
    await page.waitForSelector(".qr-box svg");
    const qr = await page.evaluate(() => ({ url: document.querySelector(".qr-url").textContent, app: appUrl(), w: document.querySelector(".qr-box").getBoundingClientRect().width }));
    check(`${w}px: share sheet shows a QR code for the app link`, qr.url === qr.app && qr.w >= 200, JSON.stringify(qr));
    check(`${w}px: share sheet has no sideways scroll`, await noOverflow(page));
    if (w === 375) {
      await page.click(".sheet-h [data-act='close']");
      await page.click('[data-act="chkupd"]');
      check("update check answers without a service worker", /Reload the page|latest/.test((await page.textContent(".toast")) || ""));
      check("QR encoder makes a valid 37x37 code for the app link", await page.evaluate(() => /viewBox="0 0 37 37"/.test(qrSVG("https://bagaljivko.github.io/Trening-app/"))));
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- data safety
  console.log("data safety");
  {
    const { ctx, page } = await open(browser, URL, null);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("training-log-v1", '{"sessions":[{"id":"x"'); });
    await page.reload();
    check("unreadable data shows a warning", !!(await page.$(".banner.bad")));
    await page.click('[data-act="gen"]');
    check("unreadable data is never overwritten", (await page.evaluate(() => localStorage.getItem("training-log-v1"))) === '{"sessions":[{"id":"x"');
    check("unreadable data is also kept as a copy", (await page.evaluate(() => localStorage.getItem("training-log-v1.unreadable"))) === '{"sessions":[{"id":"x"');
    await page.evaluate(() => { localStorage.setItem("training-log-v1", JSON.stringify({ sessions: [{ id: "a", date: new Date().toISOString(), v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8 }] }] }], settings: { count: 7, lastExport: Date.now() } })); });
    await page.reload(); await page.waitForTimeout(500);
    const sn = await page.evaluate(async () => (await snapList()).map(x => x.reason));
    check("a safety copy is made before the data format upgrade and daily", sn.includes("upgrade") && sn.includes("daily"), sn.join(","));
    check("data carries a version number", (await stored(page)).schema === 1);
    await page.evaluate(() => { S.sessions = []; saveLocal(); });
    await page.evaluate(() => openSnapshots()); await page.waitForTimeout(300);
    let daily = null;
    for (const r of await page.$$('[data-act="usesnap"]')) if (/Daily copy/.test(await r.innerText())) { daily = r; break; }
    await Promise.all([page.waitForNavigation(), daily.click()]);
    check("a safety copy brings lost workouts back", (await stored(page)).sessions.length === 1);
    await page.evaluate(() => { window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }; S.settings.count = 6; saveLocal(); });
    await page.waitForTimeout(100);
    check("a failed save is reported", /couldn't be saved/.test((await page.textContent(".banner.bad")) || ""));
    await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
    await ctx.close();
  }

  // ---------------------------------------------------------------- Google Drive (stand-in Google)
  console.log("Google Drive backup");
  {
    const files = {}; let n = 0;
    const handler = async route => {
      const req = route.request(), u = new globalThis.URL(req.url()), json = (o, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(o) });
      if (u.pathname.endsWith("/about")) return json({ user: { emailAddress: "tester@example.com" } });
      let id = (u.pathname.match(/\/files\/([^/]+)$/) || [])[1];
      if (u.pathname.startsWith("/upload/")) {
        const parts = req.postDataBuffer().toString("utf8").split(/--training[a-z0-9]+/);
        const meta = JSON.parse(parts[1].split("\r\n\r\n")[1]);
        if (!id) { id = "f" + (++n); files[id] = { id, name: meta.name }; }
        files[id].content = parts[2].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""); files[id].modifiedTime = new Date().toISOString();
        return json({ id, modifiedTime: files[id].modifiedTime });
      }
      if (req.method() === "POST" && u.pathname.endsWith("/files")) { const meta = req.postDataJSON(); id = "d" + (++n); files[id] = { id, name: meta.name, folder: true }; return json({ id }); }
      if (id && u.searchParams.get("alt") === "media") return route.fulfill({ status: 200, contentType: "application/json", body: files[id].content });
      if (id) return files[id] ? json({ id, trashed: false }) : json({ error: { message: "nf" } }, 404);
      const name = ((u.searchParams.get("q") || "").match(/name='([^']+)'/) || [])[1];
      return json({ files: Object.values(files).filter(f => f.name === name).map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime || new Date().toISOString() })) });
    };
    const gis = () => { window.google = { accounts: { oauth2: { initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: "tok", expires_in: 3600 }), 5) }), hasGrantedAllScopes: () => true, revoke: () => {} } } }; };
    const backup = () => { const f = Object.values(files).find(x => x.name === "training-log-backup.json"); return f && JSON.parse(f.content); };
    const seed = baseSeed({ sessions: [{ id: "a", date: day(3), v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8 }] }] }], plan: { created: "", v: 2, items: [{ ex: 0, sets: [{ w: 62.5, r: 8, done: false }, { w: 62.5, r: 8, done: false }] }] } });
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: "block" });
    await ctx.route("https://www.googleapis.com/**", handler); await ctx.addInitScript(gis);
    const page = await ctx.newPage(); page.on("dialog", d => d.accept());
    await page.goto(URL); await page.evaluate(s => localStorage.setItem("training-log-v1", JSON.stringify(s)), seed); await page.reload();
    await toSettings(page); await page.click('[data-act="driveconnect"]'); await page.waitForTimeout(800);
    check("connecting Drive makes a first backup", backup() && backup().sessions.length === 1 && Object.values(files).some(f => f.folder && f.name === "Training log"));
    const ups = () => Object.values(files).find(x => x.name === "training-log-backup.json").modifiedTime;
    const u0 = ups();
    await page.click('[data-tab="today"]'); await page.click('[data-act="open"][data-i="0"]'); await page.click('#ctaBox [data-act="done"]'); await page.waitForTimeout(4800);
    check("no Drive upload for a set mid-workout", ups() === u0);
    await page.click('#ctaBox [data-act="done"]'); await page.waitForTimeout(5200);
    check("finished workout is backed up to Drive", backup().sessions.length === 2);
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: "block" });
    await ctx2.route("https://www.googleapis.com/**", handler); await ctx2.addInitScript(gis);
    const p2 = await ctx2.newPage(); p2.on("dialog", d => d.accept());
    await p2.goto(URL); await toSettings(p2); await p2.click('[data-act="driveconnect"]');
    await p2.waitForSelector('[data-act="dorestore"]', { timeout: 5000 }); await p2.click('[data-act="dorestore"]'); await p2.waitForTimeout(400);
    check("a new phone gets its history back from Drive", (await p2.evaluate(() => S.sessions.length)) === 2);
    await ctx2.close();
  }

  // ---------------------------------------------------------------- updates (real service worker)
  console.log("updates wait for Reload and leave Gitara alone");
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await ctx.newPage();
    await page.goto(URL); await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async () => { const c = await caches.open("gitara-v1"); await c.put("/Gitara/index.html", new Response("gitara")); });
    serve.swOverride = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").replace(/training-v\d+/, "training-v999");   // "publish" a new version
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForSelector("#updateBar", { timeout: 30000 });
    check("a new version waits instead of taking over", await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting));
    await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.click("#updateBar button")]);
    await page.waitForTimeout(500);
    const keys = await page.evaluate(() => caches.keys());
    check("Reload switches to the new version", keys.includes("training-v999"), keys.join(","));
    check("an update never deletes Gitara's offline files", keys.includes("gitara-v1"), keys.join(","));
    serve.swOverride = null;
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
