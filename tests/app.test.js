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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
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
    check("double-tap zoom is off", await page.evaluate(() => getComputedStyle(document.body).touchAction === "manipulation"));
    await page.click('[data-tab="body"]'); await page.click('.dock [data-act="weighin"]');
    const small = await page.evaluate(() => [...document.querySelectorAll("input:not([type=file])")].filter(i => i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16).length);
    check("form inputs are 16px or larger", small === 0, small + " smaller");
    await ctx.close();
  }

  // ---------------------------------------------------------------- backup
  console.log("backup and restore");
  {
    const { ctx, page } = await open(browser, URL, busy);
    await page.click('[data-tab="history"]');
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"]')]);
    const file = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "tl-")), "backup.json");
    await dl.saveAs(file);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    check("export holds workouts, profile and weigh-ins", j.sessions.length === 6 && j.profile.name === "Test" && j.weighins.length === 1);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("training-log-v1")); s.sessions = s.sessions.slice(0, 2); localStorage.setItem("training-log-v1", JSON.stringify(s)); });
    await page.reload(); await page.click('[data-tab="history"]');
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
    await page.click('[data-tab="history"]');
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
    await page.click('[data-tab="history"]'); await page.click('[data-act="driveconnect"]'); await page.waitForTimeout(800);
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
    await p2.goto(URL); await p2.click('[data-tab="history"]'); await p2.click('[data-act="driveconnect"]');
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
