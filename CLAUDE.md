# Training log (Trening-app)

A single-file PWA (`index.html` + `sw.js`), served by GitHub Pages from `main`.

## Before every merge to main
Run the release checklist in `CHECKLIST.md` and only merge if every item passes:

```bash
git fetch origin main
```

```bash
node tests/checklist.js
```

If an item fails, fix it and run the checklist again. If it can't be fixed safely, don't merge;
stop and explain what's wrong. After merging, confirm the GitHub Pages deployment succeeded and
report the checklist results (one line per item).

## House rules
- Never change or lose saved data (history, settings, logs). No resets, no migrations without a safety copy.
- When app files change, raise the offline-cache version (`training-vNN`) in `sw.js` and `index.html`.
- Pictures are generated: edit `tools/make_images.py`, run `python3 tools/make_images.py`; static images must stay byte-identical unless a drawing is meant to change.
- Texts: write English in the code and add the Serbian version to the `SR` dictionary.
- Check new screens at 320/375/430 px, light and dark, in English and Serbian.
