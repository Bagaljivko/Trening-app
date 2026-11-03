// Small QR encoder (no external libraries), taken from the Gitara app: byte mode, error
// correction level M, versions 1-9 (up to 180 bytes). Enough for a link to the app (ISO/IEC 18004).
// Loaded on demand by the Share app sheet; exposes window.qrSVG(text, {label}).
(function(){

// Nivo M: [ukupno kodnih reči, EC reči po bloku, [[broj blokova, podataka po bloku], ...]]
const M_BLOCKS = [null,
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0];

// ---- Reed–Solomon nad GF(256), polinom 0x11d ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); }
    g = next;
  }
  return g; // g[0] = 1 (najviši stepen)
}
function rsRemainder(data, n) {
  const g = rsGenerator(n);
  const r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r[0];
    r.shift(); r.push(0);
    for (let j = 0; j < n; j++) r[j] ^= gmul(g[j + 1], f);
  }
  return r;
}

const utf8 = (s) => Array.from(new TextEncoder().encode(s));

/** Kodne reči (podaci + korekcija, isprepletane) za dati tekst. */
function codewords(bytes) {
  let ver = 0;
  for (let v = 1; v <= 9; v++) {
    const [, , groups] = M_BLOCKS[v];
    const dataCap = groups.reduce((n, [c, d]) => n + c * d, 0);
    if (4 + 8 + 8 * bytes.length <= dataCap * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('QR: tekst je predugačak');
  const [, ecLen, groups] = M_BLOCKS[ver];
  const dataCap = groups.reduce((n, [c, d]) => n + c * d, 0);
  // Bitovi: režim 0100, dužina (8 bita), bajtovi, terminator, dopuna
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);
  // Blokovi i korekcija grešaka
  const blocks = [];
  let k = 0;
  for (const [count, len] of groups) for (let c = 0; c < count; c++) { const d = data.slice(k, k + len); k += len; blocks.push({ d, e: rsRemainder(d, ecLen) }); }
  const out = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
  return { ver, words: out };
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Matrica QR koda: { size, dark(x, y) }. x = kolona, y = red. */
function qrMatrix(text) {
  const { ver, words } = codewords(utf8(text));
  const size = 17 + 4 * ver;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { mod[y][x] = v; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // linije za merenje
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) { // tragači (sa razdvajačem)
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = ALIGN[ver], last = al.length - 1;
  al.forEach((ax, i) => al.forEach((ay, j) => { // poravnanje
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask) => {
    const data = (0 << 3) | mask; // nivo M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true); // stalno tamni modul
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const v = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, v); set(b, a, v);
    }
  }
  // Podaci u cik-cak kolonama od po dva modula
  const total = words.length * 8 + REMAINDER_BITS[ver];
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (fn[y][x] || bi >= total) continue;
      mod[y][x] = bi < words.length * 8 ? ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1 : false;
      bi++;
    }
  }
  // Izaberi masku sa najmanje „kazni“ (najlakše za čitanje)
  const base = mod.map((r) => r.slice());
  let best = null;
  for (let m = 0; m < 8; m++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mod[y][x] = fn[y][x] ? mod[y][x] : base[y][x] !== MASKS[m](x, y);
    drawFormat(m);
    const p = penalty(mod, size);
    if (!best || p < best.p) best = { p, m, grid: mod.map((r) => r.slice()) };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x]) mod[y][x] = base[y][x];
  }
  const g = best.grid;
  return { size, version: ver, mask: best.m, dark: (x, y) => g[y][x] };
}

function penalty(m, n) {
  let p = 0;
  const line = (get) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) run++;
        else { if (run >= 5) p += 3 + run - 5; run = 1; }
      }
      const s = Array.from({ length: n }, (_, j) => (get(i, j) ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) { let k = s.indexOf(pat); while (k !== -1) { p += 40; k = s.indexOf(pat, k + 1); } }
    }
  };
  line((i, j) => m[i][j]);
  line((i, j) => m[j][i]);
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  p += 10 * Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5);
  return p;
}

/** SVG QR koda (crni moduli na beloj podlozi, sa tihom zonom od 4 modula). */
function qrSVG(text, { margin = 4, label = '' } = {}) {
  const q = qrMatrix(text);
  const dim = q.size + margin * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; x++) {
      if (!q.dark(x, y)) continue;
      let w = 1;
      while (x + w < q.size && q.dark(x + w, y)) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<svg class="qr-svg" viewBox="0 0 ${dim} ${dim}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
window.qrSVG = qrSVG;
})();
