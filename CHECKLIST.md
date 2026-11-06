# Release checklist

Every change goes through this before it is merged into `main` (which is what GitHub Pages
serves to phones). If any item fails, fix it and run the whole checklist again. If something
can't be fixed safely, don't merge: stop and explain what's wrong.

Run it with one command (needs Playwright and an up-to-date `origin/main` to compare with):

```bash
git fetch origin main
```

```bash
node tests/checklist.js
```

It prints PASS / FAIL for each item and ends with "OK to merge" or "DO NOT MERGE".
GitHub runs it on every push and pull request too (`.github/workflows/tests.yml`).

| # | Item | What "pass" means |
|---|------|-------------------|
| 1 | **Loads cleanly** | No console errors on any tab, Settings or the exercise screen, in English and Serbian. |
| 2 | **Pictures** | Every exercise's static picture shows unchanged when collapsed, animates when its explanation is expanded and stops when collapsed. Stretches animate in the stretch player. Lists stay still. "Reduce motion" keeps everything static. |
| 3 | **Existing features** | The full regression suite (`tests/app.test.js`) passes: starting and finishing workouts, logging sets, rest and hold timers, history, summaries, settings, backup and restore, Google Drive, language, layout at 320/375/430 px in light and dark. |
| 4 | **Saved data untouched** | The same saved data (history, settings, notes, logs in local storage) loaded by the live version and by the new one is stored exactly the same: no reset, no migration, no lost workouts. |
| 5 | **Offline, no new network calls** | The app only loads its own files, installs, and works offline after installing, including the animations. |
| 6 | **Layout** | No sideways scrolling or broken screens on phones (320, 375, 430 px) and tablets (768, 1024 px), in light and dark. |
| 7 | **Performance** | On a 4x slower CPU with 450 workouts: History opens in under 150 ms, expanding an exercise in under 60 ms, and scrolling while a picture animates stays smooth (about 60 fps). |
| 8 | **Update reaches phones** | When app files change, the offline-cache version in `sw.js` (`training-vNN`) is raised, and every file the cache lists exists. |

After merging: check that the "pages build and deployment" run on GitHub succeeded, then
report the checklist results.

Things the automated checklist can't judge, so look at them on screenshots before merging:
new screens or drawings look right, text fits in both languages, nothing looks off in dark mode.
