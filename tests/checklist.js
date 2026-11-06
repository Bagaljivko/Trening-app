// Release checklist: run before every merge to main (see CHECKLIST.md).
//   node tests/checklist.js              all items
//   node tests/checklist.js --skip-suite skip item 3 (when tests/app.test.js already ran, e.g. in CI)
// Compares against the version on origin/main (the live app) for saved data and the update version.
// Prints PASS / FAIL per item and exits with 1 if anything failed.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { execSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SKIP_SUITE = process.argv.includes("--skip-suite");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const results = [];
const item = (n, name, ok, detail = "") => { results.push({ n, name, ok, detail }); console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${n}. ${name}${detail ? "  - " + detail : ""}`); };
const day = n => new Date(Date.now() - n * 864e5).toISOString();

function serve(dir) {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
      const f = path.join(dir, p === "/" ? "index.html" : p);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, () => res(srv));
  });
}

// A realistic person's data: history, workout in progress, settings, notes, favourites, Serbian, Drive nudges.
const SEED = {
  sessions: Array.from({ length: 40 }, (_, k) => ({ id: "s" + k, date: day(200 - k * 5), v: 2, items: [{ ex: 0, sets: [{ w: 60 + k, r: 8 }, { w: 60 + k, r: 7 }] }, { ex: 39, sets: [{ w: 80, r: 5 }] }, { ex: 7, sets: [{ w: 45, r: "" }] }], summary: { v: 1, prs: [], ups: [], muscles: [], durMin: 50 } })),
  plan: { created: "", v: 2, started: Date.now() - 600000, items: [{ ex: 39, sets: [{ w: 80, r: 5, done: true }, { w: 80, r: 5, done: false }] }, { ex: 0, sets: [{ w: 60, r: 8, done: false }] }, { ex: "ng-forearm-plank", sets: [{ w: 45, r: "", done: false }] }] },
  settings: { count: 7, mute: true, lastExport: Date.now(), lang: "en", notes: { 0: "Bench 3" }, exPref: { 0: "fav", 22: "never" }, rest: "90", weekGoal: 4, nudge: { st: { skips: 1, pending: true }, core: { skips: 0, pending: false } } },
  custom: [{ id: "c1", name: "My row", group: "back" }], profile: { name: "Test", height: 183, startW: 92, goalW: 84 },
  weighins: [{ id: "w1", date: day(4).slice(0, 10), w: 88 }], schema: 1,
};
const seed = (lang = "en") => Object.assign({}, SEED, { settings: Object.assign({}, SEED.settings, { lang }) });
async function page(b, base, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, serviceWorkers: "block" }, opts));
  const p = await ctx.newPage(); p.errs = [];
  p.on("pageerror", e => p.errs.push(e.message)); p.on("console", m => { if (m.type() === "error") p.errs.push(m.text()); });
  p.on("dialog", d => d.accept());
  await p.goto(base + "index.html");
  if (opts.data !== false) { await p.evaluate(s => localStorage.setItem("training-log-v1", JSON.stringify(s)), opts.seed || seed()); await p.reload(); }
  return { ctx, p };
}

(async () => {
  const newSrv = await serve(ROOT), NEW = `http://localhost:${newSrv.address().port}/`;
  // the live version (origin/main), for data and update comparisons
  let OLD = null, oldSrv = null, oldDir = null;
  try {
    oldDir = fs.mkdtempSync(path.join(os.tmpdir(), "trening-main-"));
    execSync(`git -C "${ROOT}" archive origin/main | tar -x -C "${oldDir}"`, { stdio: "pipe" });
    oldSrv = await serve(oldDir); OLD = `http://localhost:${oldSrv.address().port}/`;
  } catch (e) { console.log("note: origin/main not available (git fetch origin main), items 4 and 8 can't compare"); }
  const b = await chromium.launch();

  // 1. Loads with no console errors: every tab and Settings, English and Serbian
  {
    const errs = [];
    for (const lang of ["en", "sr"]) {
      const { ctx, p } = await page(b, NEW, { seed: seed(lang) });
      for (const t of ["today", "exercises", "history", "body"]) { await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(150); }
      await p.click('[data-act="settings"]'); await p.waitForTimeout(150);
      await p.click('[data-act="setclose"]'); await p.click('[data-tab="today"]'); await p.click('[data-act="open"][data-i="0"]'); await p.waitForTimeout(200);
      errs.push(...p.errs.map(e => lang + ": " + e)); await ctx.close();
    }
    item(1, "App loads with no console errors (all tabs, Settings, exercise screen; English and Serbian)", errs.length === 0, errs.slice(0, 3).join(" | "));
  }

  // 2. Pictures: every static image unchanged when collapsed; animates when expanded, stops when collapsed
  {
    const { ctx, p } = await page(b, NEW);
    const r = await p.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), bad = [];
      const ids = allExercises().filter(e => typeof e.id === "number" || NGMAP[e.id]).map(e => e.id);
      for (const id of ids) {
        S.plan.items[0] = buildItem(id); focus = { i: 0 }; howOpen = false; render(false);
        for (let k = 0; k < 40 && !document.querySelector(".fpic svg"); k++) await w(25);
        const st = document.querySelector(".fpic svg"), file = await (await fetch(imgOf(exById(id)))).text();
        const staticOk = !!st && !st.querySelector("animate") && !(document.querySelector(".fpic .ill") || {})._anim && file.includes(st.querySelector("title").textContent.replace(/&/g, "&amp;"));
        howOpen = true; animT0 = 0; render();
        for (let k = 0; k < 60 && !(document.querySelector(".fpic .ill") || {})._anim; k++) await w(25);
        const s = document.querySelector(".fpic svg"), seen = new Set(); for (let k = 0; k < 5; k++) { seen.add(s.innerHTML); await w(170); }
        howOpen = false; render(); const back = document.querySelector(".fpic svg").innerHTML; await w(250);
        const stopped = back === document.querySelector(".fpic svg").innerHTML;
        if (!(staticOk && seen.size >= 3 && stopped)) bad.push(exById(id).name);
      }
      const stretchOk = STRETCHES.every(s => animOf(s));
      S.sessions.push({ id: "zz", date: new Date().toISOString(), v: 2, items: [{ ex: 0, sets: [{ w: 60, r: 8 }] }] }); startStretch("zz");
      for (let k = 0; k < 60 && !(document.querySelector(".stv .ill") || {})._anim; k++) await w(25);
      const stretchPlays = !!(document.querySelector(".stv .ill") || {})._anim; stretchClose();
      focus = null; tab = "exercises"; render(); await w(300);
      const listsStill = !document.querySelector(".ill[data-anim]") && !document.querySelector("svg animate");
      return { n: ids.length, bad, stretchOk, stretchPlays, listsStill };
    });
    await p.emulateMedia({ reducedMotion: "reduce" });
    const rm = await p.evaluate(async () => { focus = { i: 0 }; howOpen = true; render(); await new Promise(r => setTimeout(r, 300)); return !(document.querySelector(".fpic .ill") || {})._anim; });
    item(2, `Pictures: all ${r.n} exercises static when collapsed, animate when expanded, stop when collapsed; stretches animate; lists still; reduce-motion static`,
      !r.bad.length && r.stretchOk && r.stretchPlays && r.listsStill && rm && !p.errs.length, [r.bad.length ? "problems: " + r.bad.slice(0, 5).join(", ") : "", !r.stretchPlays ? "stretch player" : "", !r.listsStill ? "lists move" : "", !rm ? "reduce motion" : "", p.errs.join(" | ")].filter(Boolean).join("; "));
    await ctx.close();
  }

  // 3. Existing features: the full regression suite
  if (SKIP_SUITE) item(3, "Existing features (tests/app.test.js)", null, "run separately");
  else {
    const out = spawnSync(process.execPath, [path.join(__dirname, "app.test.js")], { encoding: "utf8", timeout: 20 * 60e3, env: process.env });
    const m = /(\d+) passed, (\d+) failed/.exec(out.stdout || "");
    item(3, "Existing features: workouts, sets, timers, history, settings, backup, Drive, language... (tests/app.test.js)", !!m && m[2] === "0", m ? `${m[1]} passed, ${m[2]} failed` : "suite did not finish");
  }

  // 4. Saved data untouched: the same data loaded by the live version and by this one is stored identically
  if (!OLD) item(4, "Saved data untouched (compared with the live version)", false, "origin/main not available");
  else {
    const stored = async base => { const { ctx, p } = await page(b, base); await p.waitForTimeout(800);
      const v = await p.evaluate(() => { const o = JSON.parse(localStorage.getItem("training-log-v1")); return JSON.stringify({ sessions: o.sessions, settings: o.settings, custom: o.custom, profile: o.profile, weighins: o.weighins, plan: o.plan, schema: o.schema }); });
      const keys = await p.evaluate(() => Object.keys(localStorage).sort().join(",")); await ctx.close(); return { v, keys }; };
    const o = await stored(OLD), n = await stored(NEW);
    item(4, "Saved data untouched: history, settings, logs load and are stored exactly as in the live version (no reset, no migration)", o.v === n.v && o.keys === n.keys, o.v !== n.v ? "stored data differs" : o.keys !== n.keys ? "storage keys differ" : "");
  }

  // 5. No new external requests; installs and works offline
  {
    const { ctx, p } = await page(b, NEW, { serviceWorkers: "allow" });
    const ext = []; ctx.on("request", r => { if (!r.url().startsWith(NEW)) ext.push(r.url()); });
    await p.evaluate(async () => { await navigator.serviceWorker.ready; }); await p.reload(); await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
    await p.click('[data-act="open"][data-i="0"]'); await p.click('[data-act="howtoggle"]'); await p.waitForTimeout(500);
    await ctx.setOffline(true); await p.reload();
    const off = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); focus = { i: 1 }; howOpen = true; animT0 = 0; render();
      for (let k = 0; k < 60 && !(document.querySelector(".fpic .ill") || {})._anim; k++) await w(25); return !!document.querySelector("main h1, .fname") && !!(document.querySelector(".fpic .ill") || {})._anim; });
    item(5, "No external requests; installs and works offline (incl. animations)", !ext.length && off && !p.errs.length, [ext.slice(0, 3).join(", "), !off ? "offline reload failed" : "", p.errs.join(" | ")].filter(Boolean).join("; "));
    await ctx.close();
  }

  // 6. Layout: phones and tablets, light and dark
  {
    const bad = [];
    for (const [w, h] of [[320, 568], [375, 667], [430, 932], [768, 1024], [1024, 1366]]) for (const scheme of ["light", "dark"]) {
      const { ctx, p } = await page(b, NEW, { viewport: { width: w, height: h }, colorScheme: scheme, isMobile: w < 700 });
      const side = async where => { if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) bad.push(`${w} ${scheme} ${where}`); };
      for (const t of ["today", "exercises", "history", "body"]) { await p.click(`[data-tab="${t}"]`); await side(t); }
      await p.click('[data-act="settings"]'); await side("settings"); await p.click('[data-act="setclose"]');
      await p.click('[data-tab="today"]'); await p.click('[data-act="open"][data-i="0"]'); await p.click('[data-act="howtoggle"]'); await p.waitForTimeout(300); await side("exercise screen");
      const pic = await p.evaluate(() => { const r = document.querySelector(".fpic svg").getBoundingClientRect(); return r.width > 50 && r.height > 40; });
      if (!pic) bad.push(`${w} ${scheme} picture`);
      if (p.errs.length) bad.push(`${w} ${scheme} errors`);
      await ctx.close();
    }
    item(6, "Layout: no sideways scroll or broken screens at 320/375/430 px phones and 768/1024 px tablets, light and dark", !bad.length, bad.slice(0, 5).join(", "));
  }

  // 7. Performance on a slowed-down phone (4x CPU)
  {
    const big = Object.assign({}, SEED, { sessions: Array.from({ length: 450 }, (_, k) => ({ id: "b" + k, date: day(1100 - k * 2.4), v: 2, items: [0, 3, 7, 22, 47, 12, 30].map(ex => ({ ex, sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }] })) })) });
    const { ctx, p } = await page(b, NEW, { seed: big });
    const cdp = await ctx.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const r = await p.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), T = f => { const a = performance.now(); f(); return performance.now() - a; };
      await w(1500);
      const history = T(() => { tab = "history"; render(false); });
      tab = "today"; focus = { i: 0 }; render(false);
      const expand = T(() => { howOpen = true; render(); }); await w(500);
      const gaps = []; let last = performance.now(), y = 0;
      await new Promise(done => { const f = now => { gaps.push(now - last); last = now; window.scrollTo(0, (y += 6) % 300); if (gaps.length < 120) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
      gaps.sort((a, b) => a - b);
      return { history: Math.round(history), expand: Math.round(expand), frame: +gaps[60].toFixed(1), frame95: +gaps[113].toFixed(1) };
    });
    item(7, "Performance (4x slower CPU, 450 workouts): no lag opening History, expanding exercises, scrolling while animating",
      r.history < 150 && r.expand < 60 && r.frame < 20 && r.frame95 < 34, `History ${r.history} ms, expand ${r.expand} ms, frames ${r.frame} ms (95%: ${r.frame95} ms)`);
    await ctx.close();
  }

  // 8. The update reaches phones: new offline-cache version, every cached file exists
  {
    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), ver = (sw.match(/training-v\d+/) || [""])[0];
    const shell = JSON.parse(sw.slice(sw.indexOf("["), sw.indexOf("];") + 1));
    const missing = shell.filter(f => f !== "./" && !fs.existsSync(path.join(ROOT, f)));
    let changed = true, oldVer = "";
    if (oldDir) { oldVer = (fs.readFileSync(path.join(oldDir, "sw.js"), "utf8").match(/training-v\d+/) || [""])[0];
      changed = execSync(`git -C "${ROOT}" diff --quiet origin/main -- index.html sw.js images fonts qr.js manifest.webmanifest icons || echo changed`, { encoding: "utf8" }).trim() === "changed"; }
    const bumped = !changed || !oldDir || ver !== oldVer;
    item(8, "Update reaches phones: offline-cache version raised when app files changed, every cached file exists", bumped && !missing.length,
      [!bumped ? `cache still ${ver} (bump it in sw.js and index.html)` : `${oldVer || "?"} -> ${ver}`, missing.length ? "missing: " + missing.slice(0, 3).join(", ") : ""].filter(Boolean).join("; "));
  }

  await b.close(); newSrv.close(); if (oldSrv) oldSrv.close();
  const failed = results.filter(r => r.ok === false);
  console.log(`\n${results.length - failed.length} of ${results.length} items passed${failed.length ? " - DO NOT MERGE" : " - OK to merge"}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
