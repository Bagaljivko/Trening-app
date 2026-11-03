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

  await browser.close(); srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
