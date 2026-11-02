#!/usr/bin/env python3
"""Generates the exercise illustrations in /images.

Same technique and style as the illustrations in Trening-za-decu: one static
SVG per exercise (viewBox 400x300) on a transparent background, with a stick
figure, a floor line, equipment and a green arrow for the movement. Colours
follow the app's theme: white figure with light-grey props on black in dark
mode, black figure with mid-grey props in light mode (see THEMES).

On top of that style this file adds gym equipment: benches, boxes, barbells
(seen end-on as a weight plate in side views), dumbbells, kettlebell, cable
towers with pulleys, and a few machines.

File names are the exercise name turned into a slug (see slug()); index.html
uses the same rule to find the picture. Both the gym exercises (SEED) and the
no-gym travel exercises (NOGYM) are read from index.html. Run from the repo root:

    python3 tools/make_images.py
"""
import math
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "images")

# Every shape is tagged with a role instead of a fixed colour, so one set of files
# follows the app's theme. The app puts the SVG straight into the page and colours
# the roles with CSS variables (--ill-near, --ill-far, ...). Opened on its own, the
# file falls back to the colours in THEMES below, following the device's light or
# dark setting.
NEAR = "@near"      # limbs closest to the viewer
FAR = "@far"        # limbs on the far side
PROP = "@prop"      # benches, boxes, chairs, machine frames, wall
FLOOR = "@floor"    # floor line
ARROW = "@arrow"    # movement arrow
IRON = "@iron"      # weights: plates, dumbbells, kettlebell, cable
IRON_IN = "@ironin"  # inside of a weight plate
THEMES = {
    "light": {"near": "#111114", "far": "#4F4F57", "prop": "#85858D", "floor": "#85858D",
              "iron": "#77777F", "ironin": "#E6E6EA", "arrow": "#008F45"},
    "dark": {"near": "#F5F5F7", "far": "#BEBEC5", "prop": "#8E8E96", "floor": "#8E8E96",
             "iron": "#9E9EA6", "ironin": "#2A2A30", "arrow": "#3DFF8F"},
}


def themed(markup):
    """Turn stroke="@role" / fill="@role" into classes ill-s-role / ill-f-role."""
    def tag(m):
        attrs = m.group(2)
        cls = []
        for kind, short in (("stroke", "s"), ("fill", "f")):
            r = re.search(kind + r'="@(\w+)"', attrs)
            if r:
                cls.append(f"ill-{short}-{r.group(1)}")
                attrs = attrs.replace(r.group(0), "")
        if not cls:
            return m.group(0)
        attrs = re.sub(r"\s+", " ", attrs).rstrip()
        return f'<{m.group(1)} class="{" ".join(cls)}"{attrs}{m.group(3)}>'
    out = re.sub(r"<(\w+)((?:\s[^<>]*?)?)(\s*/?)>", tag, markup)
    assert "@" not in out, "untagged colour left in SVG"
    return out


def svg_style():
    roles = THEMES["light"].keys()
    rules = "".join(f".ill-s-{r}{{stroke:var(--ill-{r},{THEMES['light'][r]})}}"
                    f".ill-f-{r}{{fill:var(--ill-{r},{THEMES['light'][r]})}}" for r in roles)
    dark = "".join(f"--ill-{r}:{THEMES['dark'][r]};" for r in roles)
    return f"<style>{rules}@media (prefers-color-scheme:dark){{svg{{{dark}}}}}</style>"
G = 262             # floor level for feet

TORSO, THIGH, SHIN, UARM, FARM = 72, 54, 56, 34, 32


def slug(name):
    s = name.lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ---------------------------------------------------------------- geometry
def D(a):
    r = math.radians(a)
    return (math.cos(r), -math.sin(r))


def add(p, a, L):
    d = D(a)
    return (round(p[0] + d[0] * L, 1), round(p[1] + d[1] * L, 1))


def mid(a, b, t=0.5):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def seg(a, b, color, w=10):
    return f'<line x1="{f(a[0])}" y1="{f(a[1])}" x2="{f(b[0])}" y2="{f(b[1])}" stroke="{color}" stroke-width="{w}"/>'


def poly(points, color, w=10):
    pts = " ".join(f"{f(x)},{f(y)}" for x, y in points)
    return f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{w}"/>'


def head_of(n, p):
    dx, dy = n[0] - p[0], n[1] - p[1]
    d = math.hypot(dx, dy) or 1
    return (round(n[0] + dx / d * 25), round(n[1] + dy / d * 25))


# ---------------------------------------------------------------- arrows (as in Trening-za-decu)
def arrow_head(tip, frm):
    dx, dy = tip[0] - frm[0], tip[1] - frm[1]
    d = math.hypot(dx, dy) or 1
    ux, uy = dx / d, dy / d
    L, Wd = 18, 11
    bx, by = tip[0] - ux * L, tip[1] - uy * L
    p1 = (bx - uy * Wd, by + ux * Wd)
    p2 = (bx + uy * Wd, by - ux * Wd)
    return (f'<polygon points="{f(tip[0])},{f(tip[1])} {f(p1[0])},{f(p1[1])} {f(p2[0])},{f(p2[1])}" '
            f'fill="{ARROW}" stroke="none"/>')


def shorten(a, b, k=12):
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = math.hypot(dx, dy) or 1
    return (b[0] - dx / d * k, b[1] - dy / d * k)


def arrow(spec):
    """('L', x1,y1,x2,y2, both?) straight, or ('Q', x1,y1,cx,cy,x2,y2, both?) curved."""
    kind = spec[0]
    both = spec[-1] is True
    out = []
    if kind == "L":
        a, b = spec[1:3], spec[3:5]
        a2 = shorten(b, a) if both else a
        b2 = shorten(a, b)
        out.append(seg(a2, b2, ARROW, 6))
        out.append(arrow_head(b, a))
        if both:
            out.append(arrow_head(a, b))
    else:
        a, c, b = spec[1:3], spec[3:5], spec[5:7]
        a2 = shorten(c, a) if both else a
        b2 = shorten(c, b)
        out.append(f'<path d="M{f(a2[0])} {f(a2[1])} Q{f(c[0])} {f(c[1])} {f(b2[0])} {f(b2[1])}" fill="none" '
                   f'stroke="{ARROW}" stroke-width="6"/>')
        out.append(arrow_head(b, c))
        if both:
            out.append(arrow_head(a, c))
    return "".join(out)


# ---------------------------------------------------------------- equipment
def plate(c, r=28):
    """A barbell seen end-on (side view), or a loose weight plate."""
    return (f'<circle cx="{f(c[0])}" cy="{f(c[1])}" r="{r}" fill="{IRON_IN}" stroke="{IRON}" stroke-width="6"/>'
            f'<circle cx="{f(c[0])}" cy="{f(c[1])}" r="{max(4, r // 5)}" fill="{IRON}"/>')


def dumbbell(c, a=0, L=30):
    """Dumbbell centred on the hand c, handle along angle a."""
    p1, p2 = add(c, a, L / 2), add(c, a + 180, L / 2)
    out = [seg(p1, p2, IRON, 5)]
    for p in (p1, p2):
        out.append(seg(add(p, a + 90, 9), add(p, a - 90, 9), IRON, 12))
    return "".join(out)


def barbell_front(c, half=120, y_off=0):
    """A barbell seen from the front: long bar with plates at the ends."""
    x, y = c[0], c[1] + y_off
    out = [seg((x - half, y), (x + half, y), IRON, 5)]
    for s in (-1, 1):
        for k, h in ((16, 26), (30, 22)):
            px = x + s * (half - k)
            out.append(seg((px, y - h), (px, y + h), IRON, 10))
    return "".join(out)


def kettlebell(c):
    x, y = c
    return (f'<path d="M{f(x - 11)} {f(y + 4)} C{f(x - 11)} {f(y - 14)} {f(x + 11)} {f(y - 14)} {f(x + 11)} {f(y + 4)}" '
            f'fill="none" stroke="{IRON}" stroke-width="5"/>'
            f'<circle cx="{f(x)}" cy="{f(y + 16)}" r="16" fill="{IRON}"/>')


def bag(c):
    """Bulgarian bag: a thick crescent with the horns up."""
    x, y = c
    return (f'<path d="M{f(x - 34)} {f(y - 10)} Q{f(x)} {f(y + 30)} {f(x + 34)} {f(y - 10)}" fill="none" '
            f'stroke="{IRON}" stroke-width="16"/>')


def bench(x1, x2, top=200, legs=True):
    out = [seg((x1, top + 6), (x2, top + 6), PROP, 12)]
    if legs:
        out += [seg((x1 + 14, top + 12), (x1 + 14, G + 6), PROP, 7),
                seg((x2 - 14, top + 12), (x2 - 14, G + 6), PROP, 7)]
    return "".join(out)


def incline_bench(seat_x1, seat_x2, seat_y, angle, length, back_at="left"):
    """Seat pad plus a back pad rising from one end of the seat at `angle`."""
    start = (seat_x1, seat_y) if back_at == "left" else (seat_x2, seat_y)
    end = add(start, angle, length)
    leg_x = (seat_x1 + seat_x2) / 2
    return "".join([
        seg((seat_x1, seat_y), (seat_x2, seat_y), PROP, 12),
        seg(start, end, PROP, 12),
        seg((leg_x, seat_y + 6), (leg_x, G + 6), PROP, 7),
        seg(mid(start, end, 0.55), (mid(start, end, 0.55)[0], G + 6), PROP, 6),
        seg((seat_x1 - 10, G + 6), (seat_x2 + 10, G + 6), PROP, 6),
    ])


def box(x1, x2, top):
    return (f'<rect x="{x1}" y="{top}" width="{x2 - x1}" height="{G + 8 - top}" rx="4" fill="none" '
            f'stroke="{PROP}" stroke-width="7"/>')


def wall(x):
    return (seg((x, 30), (x, G + 6), PROP, 8) +
            "".join(seg((x, y), (x + (12 if x > 200 else -12), y - 12), PROP, 3) for y in range(50, G, 26)))


def tower(x, top=34):
    """Cable tower: post with a weight stack at the bottom."""
    out = [seg((x, top), (x, G + 6), PROP, 10), seg((x - 18, G + 6), (x + 18, G + 6), PROP, 8)]
    for i in range(4):
        y = G - 12 - i * 11
        out.append(seg((x - 13, y), (x + 13, y), PROP, 7))
    return "".join(out)


def pulley(c):
    return f'<circle cx="{f(c[0])}" cy="{f(c[1])}" r="8" fill="{IRON_IN}" stroke="{IRON}" stroke-width="4"/>'


def cable(a, b):
    return seg(a, b, IRON, 3)


def handle(c, a=90, L=24):
    return seg(add(c, a, L / 2), add(c, a + 180, L / 2), IRON, 6)


def rope(c):
    return seg(c, (c[0] - 7, c[1] + 18), IRON, 6) + seg(c, (c[0] + 7, c[1] + 18), IRON, 6)


def bar_frame(y, x1, x2):
    """Pull-up bar or dip bars on two posts."""
    return seg((x1, y), (x2, y), PROP, 8) + seg((x1, y), (x1, G + 6), PROP, 7) + seg((x2, y), (x2, G + 6), PROP, 7)


def pause_mark(x, y):
    return seg((x, y), (x, y + 22), FAR, 6) + seg((x + 12, y), (x + 12, y + 22), FAR, 6)


def speed(x, y, n=3, length=34, gap=14):
    return "".join(seg((x, y + i * gap), (x - length + i * 6, y + i * gap), FAR, 4) for i in range(n))


# ---------------------------------------------------------------- figure
def body(P, t, legs, arms, H=None, **kw):
    """Forward kinematics. Angles in degrees, 0 = right, 90 = up.
    t: torso hip->neck; legs: [(thigh, shin) far, near]; arms: [(upper, fore) far, near]."""
    N = add(P, t, TORSO)
    L = []
    for th, sh in legs:
        k = add(P, th, THIGH)
        L.append((k, add(k, sh, SHIN)))
    A = []
    for ua, fa in arms:
        e = add(N, ua, UARM)
        A.append((e, add(e, fa, FARM)))
    d = dict(N=N, P=P, legs=L, arms=A)
    if H:
        d["H"] = H
    d.update(kw)
    return d


def hip_over_foot(foot, th, sh):
    """Hip position so that the near leg (thigh th, shin sh) ends at foot."""
    k = add(foot, sh + 180, SHIN)
    return add(k, th + 180, THIGH)


def shin_to_floor(k, forward=True, floor=G):
    dy = floor - k[1]
    if dy >= SHIN:
        return 270
    a = math.degrees(math.asin(dy / SHIN))
    return 360 - a if forward else 180 + a


def hand(d, i=1):
    return d["arms"][i][1]


def elbow(d, i=1):
    return d["arms"][i][0]


def foot(d, i=1):
    return d["legs"][i][1]


def figure(p):
    N, P = p["N"], p["P"]
    H = p.get("H") or head_of(N, P)
    (k1, f1), (k2, f2) = p["legs"]
    (e1, w1), (e2, w2) = p["arms"]
    out = [poly([P, k1, f1], FAR), poly([N, e1, w1], FAR)]
    for a, b in p.get("far_extra", []):
        out.append(seg(a, b, FAR, 8))
    out.append(p.get("mid", ""))            # equipment between far and near limbs
    out.append(seg(N, P, NEAR, 13))
    out.append(seg(N, H, NEAR, 8))
    out.append(poly([P, k2, f2], NEAR))
    out.append(poly([N, e2, w2], NEAR))
    for a, b in p.get("near_extra", []):
        out.append(seg(a, b, NEAR, 8))
    out.append(f'<circle cx="{f(H[0])}" cy="{f(H[1])}" r="18" fill="{NEAR}"/>')
    return "".join(out)


def svg(title, p):
    body_ = []
    if p.get("ground", True):
        body_.append(seg((24, G + 8), (376, G + 8), FLOOR, 4))
    body_ += p.get("props", [])
    body_ += p.get("back", [])
    body_.append(figure(p))
    body_ += p.get("front", [])
    body_ += p.get("lines", [])
    body_ += [arrow(a) for a in p.get("arrows", [])]
    t = title.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="{t}">'
            f'<title>{t}</title>{svg_style()}'
            f'<g stroke-linecap="round" stroke-linejoin="round">{themed("".join(body_))}</g></svg>\n')


def X(d, **kw):
    """Merge extra layers into a pose dict (lists are appended)."""
    for k, v in kw.items():
        if isinstance(v, list):
            d[k] = d.get(k, []) + v
        else:
            d[k] = v
    return d


# ---------------------------------------------------------------- base poses
def stand(arms, x=200, legs=((270, 270), (270, 270)), lean=90):
    P = hip_over_foot((x, G), *legs[1])
    return body(P, lean, list(legs), arms)


def front_stand(arms, x=200, spread=8, knee=0):
    """Front view: far = figure's right (screen left)."""
    legs = [(270 - spread, 270 - spread + knee), (270 + spread, 270 + spread - knee)]
    P = hip_over_foot((x + math.sin(math.radians(spread)) * (THIGH + SHIN), G), *legs[1])
    P = (x, P[1])
    return body(P, 90, legs, arms)


def squat_pose(arms, x=200, depth=1.0, lean=60):
    """Side squat; depth 1 = thighs parallel."""
    sh = 270 - 20 * depth
    th = 270 + 90 * depth
    P = hip_over_foot((x, G), th, sh)
    return body(P, lean + (90 - lean) * (1 - depth), [(th - 3, sh), (th, sh)], arms)


def hinge(arms, x=200, torso=20, knee=8, legs=None):
    th = 270 + knee
    sh = 270 - knee
    P = hip_over_foot((x, G), th, sh)
    return body(P, 180 - torso if torso > 90 else torso, legs or [(th - 2, sh), (th, sh)], arms)


def lie_back(arms, P=(232, 190), legs=None):
    """Lying on a flat bench, head to the left, feet on the floor."""
    legs = legs or [(343, 268), (346, 270)]
    k = add(P, legs[1][0], THIGH)
    sh = shin_to_floor(k)
    k0 = add(P, legs[0][0], THIGH)
    sh0 = shin_to_floor(k0)
    return body(P, 180, [(legs[0][0], sh0), (legs[1][0], sh)], arms)


def floor_back(arms, legs, t=180, P=(222, 246)):
    """Lying on the floor on the back, head left."""
    d = body(P, t, legs, arms)
    if t == 180:
        d["H"] = (d["N"][0] - 24, d["N"][1] - 2)
    return d


def seated(arms, P=(172, 204), t=92, legs=((358, 272), (0, 270))):
    k = add(P, legs[1][0], THIGH)
    k0 = add(P, legs[0][0], THIGH)
    return body(P, t, [(legs[0][0], shin_to_floor(k0)), (legs[1][0], shin_to_floor(k))], arms)


# reference plank / push-up geometry (from Trening-za-decu)
def pushup(N=(252, 200), P=(170, 225), hands=None, legs=None, arms=None):
    d = dict(N=N, P=P,
             legs=legs or [((128, 240), (86, 256)), ((130, 242), (90, 258))],
             arms=arms or [((N[0] - 2, 230), (N[0] - 2, G)), ((N[0] + 4, 230), (N[0] + 6, G))])
    return d


def plank_forearm():
    return dict(N=(252, 210), P=(172, 230),
                legs=[((130, 241), (88, 254)), ((132, 243), (92, 257))],
                arms=[((248, 258), (290, 258)), ((256, 258), (298, 260))])


# ---------------------------------------------------------------- exercises
A_DOWN = [(266, 272), (272, 268)]
A_FWD = [(355, 0), (2, 2)]
A_CHEST = [(300, 120), (305, 125)]


def ex_bench_press(close=False, incline=None, dumbbells=False, fly=False):
    if incline:
        seat_y = 214
        P = (226, seat_y - 10)
        t = 180 - incline
        k = add(P, 352, THIGH)
        legs = [(348, shin_to_floor(add(P, 348, THIGH))), (352, shin_to_floor(k))]
        if fly:
            arms = [(t - 90, t - 90 + 8), (t - 200, t - 190)]
        else:
            arms = [(68, 78), (66, 80)]
        d = body(P, t, legs, arms)
        n_off = add(P, t - 90, 0)
        back_len = 150
        props = [incline_bench(P[0] - 10, P[0] + 40, seat_y + 2, t, back_len)]
        d["props"] = props
    else:
        if fly:
            arms = [(78, 92), (300, 262)]
        else:
            arms = [(62 - (8 if close else 0), 92), (60 - (8 if close else 0), 94)]
        d = lie_back(arms)
        d["props"] = [bench(96, 256, 200)]
    h = hand(d)
    if fly:
        h0 = hand(d, 0)
        d["back"] = [dumbbell(h0, 0, 26)]
        d["front"] = [dumbbell(h, 0, 26)]
        d["arrows"] = [("Q", h[0] + 26, h[1] - 6, h[0] + 70, (h[1] + h0[1]) / 2, h0[0] + 30, h0[1] + 4)]
    elif dumbbells:
        d["back"] = [dumbbell(hand(d, 0), 0)]
        d["front"] = [dumbbell(h, 0)]
        d["arrows"] = [("L", h[0] + 50, h[1] + 70, h[0] + 50, h[1] - 6, True)]
    else:
        d["back"] = [plate(h, 30)]
        d["arrows"] = [("L", h[0] + 56, h[1] + 72, h[0] + 56, h[1] - 6, True)]
    return d


def ex_curl(kind="db", mid_=False, hammer=False):
    fa = 0 if mid_ else 34
    d = stand([(268, 272), (272, fa)])
    h = hand(d)
    e = elbow(d)
    if kind == "db":
        # hammer: neutral grip shows the dumbbell upright; otherwise along the forearm's normal
        d["back"] = [dumbbell(hand(d, 0), 90 if hammer else 0, 26)]
        d["front"] = [dumbbell(h, fa + 90 if hammer else fa, 26)]
    elif kind == "bar":
        d["back"] = [plate(h, 24)]
    d["arrows"] = [("Q", e[0] + 42, e[1] + 46, e[0] + 82, e[1] + 4, e[0] + 50, e[1] - 44)]
    return d


def ex_cable_curl():
    d = stand([(268, 62), (270, 60)], x=180)
    h = hand(d)
    pul = (300, G - 6)
    d["props"] = [tower(312)]
    d["back"] = [pulley(pul), cable(pul, h)]
    d["front"] = [handle(h, 90, 20)]
    d["arrows"] = [("Q", 230, 140, 250, 100, 222, 60)]
    return d


def ex_pushdown(grip="bar"):
    d = stand([(268, 300), (272, 292)], x=176, lean=94)
    h = hand(d)
    top = (300, 40)
    d["props"] = [tower(312, 30)]
    d["back"] = [pulley(top), cable(top, h)]
    d["front"] = [rope(h) if grip == "rope" else handle(h, 0, 26)]
    d["arrows"] = [("Q", 238, 90, 262, 120, 240, 162)]
    return d


def ex_overhead_ext(kind="db", seated_=False):
    # seated on a bench so the weight overhead stays inside the picture
    arms = [(96, 72), (94, 70)]
    d = seated(arms, P=(186, 204), t=90)
    d["props"] = [bench(120, 230, 208)]
    h = hand(d)
    e = elbow(d)
    if kind == "db":
        d["back"] = [dumbbell(hand(d, 0), 0, 26)]
        d["front"] = [dumbbell(h, 0, 26)]
    elif kind == "bar":
        d["back"] = [plate(h, 24)]
    elif kind == "one":
        d["front"] = [dumbbell((h[0], h[1] - 4), 90, 30)]
    d["arrows"] = [("Q", e[0] - 30, e[1] + 30, e[0] - 46, e[1] - 20, h[0] - 30, h[1] - 6)]
    return d


def ex_overhead_rope():
    d = stand([(70, 30), (72, 34)], x=210, legs=((262, 272), (280, 268)), lean=82)
    h = hand(d)
    top = (90, 40)
    d["props"] = [tower(78, 30)]
    d["back"] = [pulley(top), cable(top, h)]
    d["front"] = [rope(h)]
    d["arrows"] = [("Q", h[0] - 10, h[1] + 70, h[0] + 30, h[1] + 40, h[0] + 34, h[1] - 6)]
    return d


def ex_kickback():
    d = hinge([(272, 270), (186, 180)], torso=24, knee=14)
    h = hand(d)
    d["back"] = [dumbbell(hand(d, 0), 0, 24)]
    d["front"] = [dumbbell(h, 90, 24)]
    e = elbow(d)
    d["arrows"] = [("Q", e[0] + 4, e[1] + 46, h[0] - 6, e[1] + 46, h[0] - 14, h[1] + 18)]
    return d


def ex_lateral(front_view=True, cable_=False):
    arms = [(195, 185), (345, 355)]
    d = front_stand(arms)
    hl, hr = hand(d, 0), hand(d, 1)
    if cable_:
        d["arms"][0] = (add(d["N"], 262, UARM), add(add(d["N"], 262, UARM), 274, FARM))
        pul = (90, G - 6)
        d["props"] = [tower(78)]
        d["back"] = [pulley(pul)]
        d["front"] = [cable(pul, hr), handle(hr, 90, 18)]
        d["arrows"] = [("Q", 250, 210, 296, 196, 314, 138)]
    else:
        d["front"] = [dumbbell(hl, 90, 24), dumbbell(hr, 90, 24)]
        d["arrows"] = [("Q", 110, 180, 96, 150, 104, 106), ("Q", 290, 180, 304, 150, 296, 106)]
    return d


def ex_front_raise(cable_=False):
    d = stand([(268, 270), (2, 2)], x=190)
    h = hand(d)
    if cable_:
        pul = (96, G - 6)
        d["props"] = [tower(84)]
        d["back"] = [pulley(pul), cable(pul, h)]
        d["front"] = [handle(h, 90, 18)]
    else:
        d["back"] = [dumbbell(hand(d, 0), 90, 24)]
        d["front"] = [dumbbell(h, 90, 24)]
    d["arrows"] = [("Q", 238, 186, 296, 170, h[0] + 18, h[1] + 26)]
    return d


def ex_shoulder_press(kind="db", arnold=False):
    if kind == "bar":
        # mid-press: bar just past the forehead, head moved back
        d = stand([(36, 104), (38, 106)], lean=93)
        h = hand(d)
        d["H"] = (d["N"][0] - 10, d["N"][1] - 23)
        d["back"] = [plate(h, 24)]
        d["arrows"] = [("L", 290, 120, 290, 20)]
        return d
    if arnold:
        d = front_stand([(150, 92), (30, 88)])
        d["front"] = [dumbbell(hand(d, 0), 0, 24), dumbbell(hand(d, 1), 0, 24)]
        d["arrows"] = [("Q", 300, 120, 330, 60, 280, 30), ("Q", 100, 120, 70, 60, 120, 30)]
        return d
    d = front_stand([(160, 92), (20, 88)])
    d["front"] = [dumbbell(hand(d, 0), 0, 24), dumbbell(hand(d, 1), 0, 24)]
    d["arrows"] = [("L", 320, 130, 320, 46, True), ("L", 80, 130, 80, 46, True)]
    return d


def ex_upright_row():
    d = stand([(300, 140), (310, 150)])
    h = hand(d)
    d["back"] = [dumbbell(hand(d, 0), 0, 24)]
    d["front"] = [dumbbell(h, 0, 24)]
    d["arrows"] = [("L", 262, 160, 262, 90)]
    return d


def ex_reverse_fly():
    # front view, bent over: head dropped in front, arms spread wide
    d = dict(N=(200, 150), P=(200, 140), H=(200, 176),
             legs=[((186, 196), (180, G)), ((214, 196), (220, G))],
             arms=[((166, 156), (132, 152)), ((234, 156), (268, 152))])
    d["front"] = [dumbbell((132, 152), 90, 24), dumbbell((268, 152), 90, 24)]
    d["arrows"] = [("Q", 150, 230, 104, 220, 104, 176), ("Q", 250, 230, 296, 220, 296, 176)]
    return d


def ex_snatch():
    d = stand([(270, 268), (54, 96)], lean=92)
    h = hand(d)
    d["front"] = [dumbbell(h, 0, 26)]
    d["arrows"] = [("L", 290, 250, 290, 40)]
    return d


# ---- squats and lunges
def ex_squat(hold="none", box_=False, x=214, depth=1.0):
    arms = {
        "none": [(355, 2), (0, 4)],
        "chest": [(300, 110), (306, 116)],
        "plate_front": [(10, 12), (12, 14)],
        "sides": [(274, 272), (278, 276)],
        "overhead": [(80, 88), (82, 90)],
        "between": [(282, 274), (286, 278)],
        "back_bar": [(250, 60), (254, 64)],
        "front_bar": [(10, 140), (14, 142)],
        "front_db": [(330, 110), (334, 116)],
        "zercher": [(320, 70), (324, 74)],
    }[hold]
    lean = 74 if hold in ("front_bar", "front_db", "zercher", "chest", "overhead") else 60
    d = squat_pose(arms, x=x, depth=depth, lean=lean)
    h, h0 = hand(d), hand(d, 0)
    N, P = d["N"], d["P"]
    t = math.degrees(math.atan2(-(N[1] - P[1]), N[0] - P[0]))
    on_back = add(add(N, t + 180, 6), t + 90, 20)
    on_front = add(add(N, t + 180, 10), t - 90, 22)
    if hold in ("front_bar", "front_db", "chest"):
        e = add(N, t - 70, UARM) if hold != "chest" else add(N, 280, UARM)
        d["arms"] = [(add(e, 0, -2), on_front), (e, on_front)]
        h = h0 = on_front
    if hold == "chest":
        d["front"] = [dumbbell(h, 90, 30)]
    elif hold == "plate_front":
        d["front"] = [plate(h, 24)]
    elif hold == "sides":
        d["back"] = [dumbbell(h0, 0, 24)]
        d["front"] = [dumbbell(h, 0, 24)]
    elif hold == "overhead":
        d["back"] = [plate((h[0], h[1] - 4), 20)]
    elif hold == "between":
        d["front"] = [dumbbell((h[0], h[1] + 10), 90, 30)]
    elif hold == "back_bar":
        d["back"] = [plate(on_back, 24)]
    elif hold == "front_bar":
        d["front"] = [plate(on_front, 22)]
    elif hold == "front_db":
        d["front"] = [dumbbell(on_front, t, 26)]
    elif hold == "zercher":
        d["front"] = [kettlebell((elbow(d)[0] + 8, elbow(d)[1] - 18))]
    if box_:
        P = d["P"]
        d["props"] = [box(int(P[0]) - 66, int(P[0]) + 4, int(P[1]) + 10)]
    d["arrows"] = d.get("arrows", []) + [("L", 70 if not box_ else 334, 110, 70 if not box_ else 334, 230, True)]
    return d


def ex_jump_squat(vertical=False):
    if vertical:
        d = stand([(250, 270), (254, 272)], legs=((262, 280), (268, 276)))
    else:
        d = stand([(300, 330), (304, 334)], legs=((258, 282), (262, 278)))
    d = shift(d, 0, -22)
    d["lines"] = [seg((176, G + 2), (224, G + 2), FAR, 4)]
    d["arrows"] = [("L", 300, 230, 300, 80)]
    return d


def shift(d, dx, dy):
    mv = lambda p: (p[0] + dx, p[1] + dy)
    d["N"], d["P"] = mv(d["N"]), mv(d["P"])
    d["legs"] = [(mv(k), mv(f_)) for k, f_ in d["legs"]]
    d["arms"] = [(mv(e), mv(h)) for e, h in d["arms"]]
    if "H" in d:
        d["H"] = mv(d["H"])
    return d


def ex_wall_sit():
    d = dict(N=(146, 124), P=(146, 200),
             legs=[((198, 199), (198, G)), ((202, 202), (202, G))],
             arms=[((172, 150), (190, 186)), ((178, 154), (198, 190))])
    d["props"] = [wall(124)]
    d["lines"] = [seg((192, 226), (192, 252), FAR, 3)]
    d["arrows"] = [("L", 262, 130, 262, 205)]
    return d


def ex_lunge(kind="reverse"):
    if kind == "bulgarian":
        P = (196, 186)
        d = body(P, 88, [(240, 180), (330, 272)], [(272, 270), (270, 272)])
        d["legs"][1] = (d["legs"][1][0], (d["legs"][1][0][0] + 4, G))
        k0 = d["legs"][0][0]
        d["legs"][0] = (k0, (k0[0] - 52, 206))
        d["props"] = [bench(60, 150, 202)]
        d["back"] = [dumbbell(hand(d, 0), 0, 24)]
        d["front"] = [dumbbell(hand(d, 1), 0, 24)]
        d["arrows"] = [("L", 300, 120, 300, 220, True)]
        return d
    P = (205, 190)
    d = body(P, 90, [(250, 196), (330, 272)], [(272, 270), (268, 272)])
    k1 = d["legs"][1][0]
    d["legs"][1] = (k1, (k1[0] + 2, G))
    k0 = d["legs"][0][0]
    d["legs"][0] = (k0, (k0[0] - 46, 256))
    d["far_extra"] = [((k0[0] - 46, 256), (k0[0] - 52, G))]
    if kind == "reverse":
        d["arrows"] = [("Q", 170, 150, 110, 150, 96, 220)]
    elif kind == "static":
        d["arrows"] = [("L", 300, 120, 300, 220, True)]
    return d


def ex_side_lunge():
    # front view: one knee bent, other leg straight out to the side
    d = dict(N=(232, 104), P=(226, 178),
             legs=[((178, 214), (128, G)), ((262, 210), (262, G))],
             arms=[((214, 136), (230, 160)), ((248, 136), (238, 160))])
    d["arrows"] = [("L", 110, 290, 270, 290, True)]
    return d


def ex_cross_lunge():
    d = ex_lunge("none")
    d["arms"][1] = (add(d["N"], 300, UARM), add(add(d["N"], 300, UARM), 290, FARM))
    d["arrows"] = [("Q", 170, 150, 120, 140, 116, 230)]
    return d


def ex_step_up():
    # near foot up on the bench, far leg still on the floor
    P = (232, 144)
    d = dict(N=(234, 72), P=P,
             legs=[((226, 198), (214, G)), ((278, 156), (272, 196))],
             arms=[((226, 104), (220, 134)), ((242, 104), (248, 134))])
    d["props"] = [bench(240, 340, 196)]
    d["arrows"] = [("L", 170, 230, 170, 110)]
    return d


def ex_broad_jump():
    d = dict(N=(250, 98), P=(200, 152),
             legs=[((238, 178), (212, 218)), ((246, 180), (220, 222))],
             arms=[((280, 106), (312, 100)), ((284, 112), (316, 106))])
    d["arrows"] = [("L", 90, 290, 330, 290)]
    return d


def ex_jump_tuck():
    d = dict(N=(200, 74), P=(200, 148),
             legs=[((180, 118), (174, 168)), ((220, 118), (226, 168))],
             arms=[((164, 94), (144, 116)), ((236, 94), (256, 116))])
    d["arrows"] = [("Q", 110, 220, 200, 170, 290, 220, True)]
    return d


def ex_jacks():
    d = dict(N=(200, 92), P=(200, 166),
             legs=[((176, 214), (150, G)), ((224, 214), (250, G))],
             arms=[((176, 62), (196, 36)), ((224, 62), (204, 36))])
    d["arrows"] = [("Q", 128, 150, 104, 84, 150, 46), ("Q", 272, 150, 296, 84, 250, 46)]
    return d


def ex_sumo(kind="bw"):
    d = dict(N=(200, 112), P=(200, 186),
             legs=[((152, 210), (140, G)), ((248, 210), (260, G))],
             arms=[((186, 146), (196, 176)), ((214, 146), (204, 176))])
    if kind == "bw":
        d["arms"] = [((176, 130), (196, 112)), ((224, 130), (204, 112))]
    else:
        d["front"] = [dumbbell((200, 196), 90, 30)]
    d["arrows"] = [("L", 320, 110, 320, 200, True)]
    return d


def ex_sumo_deadlift():
    d = dict(N=(200, 134), P=(200, 200),
             legs=[((150, 222), (136, G)), ((250, 222), (264, G))],
             arms=[((186, 170), (180, 210)), ((214, 170), (220, 210))])
    d["back"] = [barbell_front((200, 212), 150)]
    d["arrows"] = [("L", 360, 230, 360, 130)]
    return d


def ex_bw_squat(narrow_hold=False, sumo=False):
    d = ex_squat("none", x=214)
    if narrow_hold:
        d["arrows"] = []
        d["lines"] = [pause_mark(318, 120)]
    return d


# ---- hinges, deadlifts, rows
def ex_deadlift(kind="bar", single=False, stiff=False):
    knee = 6 if stiff else 18
    if single:
        P = (200, 152)
        d = body(P, 166, [(180, 180), (272, 270)], [(268, 270), (272, 270)])
        k1 = d["legs"][1][0]
        d["legs"][1] = (k1, (k1[0], G))
        d["back"] = [dumbbell(hand(d, 0), 0, 24)]
        d["front"] = [dumbbell(hand(d, 1), 0, 24)]
        d["arrows"] = [("Q", 290, 140, 300, 70, 240, 50)]
        return d
    d = hinge([(266, 272), (272, 268)], torso=28 if kind == "bar" else 24, knee=knee)
    h = hand(d)
    if kind == "bar":
        d["back"] = [plate((h[0], h[1] + 4), 30)]
    else:
        d["back"] = [dumbbell(hand(d, 0), 0, 24)]
        d["front"] = [dumbbell(h, 0, 24)]
    d["arrows"] = [("Q", d["N"][0] + 56, d["N"][1] + 40, d["N"][0] + 66, d["N"][1] - 40, d["N"][0] + 10, d["N"][1] - 70)]
    return d


def ex_good_morning(kind="bar"):
    d = hinge([(250, 50), (254, 54)], torso=22, knee=10)
    N, P = d["N"], d["P"]
    t = math.degrees(math.atan2(-(N[1] - P[1]), N[0] - P[0]))
    if kind == "bar":
        d["back"] = [plate(add(add(N, t + 180, 8), t + 90, 20), 22)]
        d["arms"] = [(add(N, t + 120, 22), add(add(N, t + 180, 8), t + 90, 20))] * 2
    else:
        d["arms"] = [(add(N, 300, UARM), add(add(N, 300, UARM), 100, FARM)),
                     (add(N, 305, UARM), add(add(N, 305, UARM), 105, FARM))]
        d["front"] = [dumbbell(hand(d), 0 + 22, 26)]
    d["arrows"] = [("Q", N[0] + 56, N[1] + 40, N[0] + 66, N[1] - 40, N[0] + 10, N[1] - 70)]
    return d


def ex_row(kind="bent"):
    if kind == "one_arm":
        # far knee and far hand on the bench, near leg standing, near arm rowing
        N, P = (232, 150), (158, 152)
        d = dict(N=N, P=P,
                 legs=[((160, 192), (104, 192)), ((150, 206), (142, G))],
                 arms=[((236, 172), (238, 192)), ((206, 128), (210, 160))])
        d["props"] = [bench(90, 270, 192)]
        d["front"] = [dumbbell((210, 160), 0, 24)]
        d["arrows"] = [("L", 300, 236, 300, 130)]
        return d
    d = hinge([(240, 300), (230, 290)], torso=24, knee=18)
    h = hand(d)
    if kind == "bent":
        d["back"] = [dumbbell(hand(d, 0), 0, 24)]
        d["front"] = [dumbbell(h, 0, 24)]
        d["arrows"] = [("L", h[0] + 40, h[1] + 70, h[0] + 40, h[1] + 4)]
    elif kind == "rope":
        pul = (330, G - 6)
        d["props"] = [tower(342)]
        d["back"] = [pulley(pul), cable(pul, h)]
        d["front"] = [rope((h[0], h[1] - 6))]
        d["arrows"] = [("L", h[0] + 80, h[1] - 30, h[0] + 6, h[1] - 30)]
    elif kind == "reverse":
        d = hinge([(250, 330), (244, 326)], torso=60, knee=14)
        h = hand(d)
        pul = (330, G - 6)
        d["props"] = [tower(342)]
        d["back"] = [pulley(pul), cable(pul, h)]
        d["front"] = [handle(h, 90, 20)]
        d["arrows"] = [("L", h[0] + 70, h[1] - 34, h[0] + 6, h[1] - 34)]
    return d


def ex_back_extension():
    feet = (106, 236)
    P = (196, 178)
    d = dict(N=add(P, 36, TORSO), P=P,
             legs=[((152, 206), (104, 232)), ((154, 208), (108, 236))],
             arms=[])
    N = d["N"]
    e = add(N, 240, 26)
    d["arms"] = [(e, add(e, 20, 26)), (add(N, 236, 26), add(add(N, 236, 26), 16, 26))]
    pad_a, pad_b = (166, 214), (206, 190)
    d["props"] = [seg(pad_a, pad_b, PROP, 14), seg((186, 208), (206, G + 6), PROP, 7),
                  f'<circle cx="96" cy="250" r="9" fill="none" stroke="{PROP}" stroke-width="6"/>',
                  seg((96, 250), (130, G + 6), PROP, 6), seg((130, G + 6), (230, G + 6), PROP, 7)]
    d["arrows"] = [("Q", 300, 214, 320, 160, 296, 112)]
    return d


# ---- benches, dips
def ex_bench_dips(straight=True, bars=False):
    if bars:
        # bottom of a dip: upper arms back, hands on the bars under the elbows
        d = dict(N=(214, 108), P=(198, 180),
                 legs=[((204, 222), (172, 236)), ((210, 224), (178, 240))],
                 arms=[((182, 112), (180, 148)), ((186, 116), (186, 150))])
        d["props"] = [seg((130, 150), (270, 150), PROP, 8), seg((140, 150), (140, G + 6), PROP, 7),
                      seg((260, 150), (260, G + 6), PROP, 7)]
        d["arrows"] = [("L", 320, 60, 320, 160, True)]
        return d
    # hands on the bench edge behind, hips dropped in front of the bench
    N, P = (142, 166), (150, 236)
    if straight:
        legs = [((204, 240), (260, 254)), ((206, 242), (262, 258))]
    else:
        legs = [((200, 214), (206, G)), ((204, 216), (212, G))]
    d = dict(N=N, P=P, legs=legs,
             arms=[((118, 176), (110, 200)), ((122, 178), (114, 200))])
    d["props"] = [bench(30, 118, 200)]
    d["arrows"] = [("L", 190, 110, 190, 180, True)]
    return d


def ex_hang(kind="legs"):
    d = dict(N=(200, 114), P=(200, 186),
             arms=[((198, 80), (198, 48)), ((204, 80), (204, 48))])
    if kind == "legs":
        d["legs"] = [((252, 182), (306, 176)), ((254, 186), (308, 182))]
        d["arrows"] = [("Q", 250, 250, 320, 250, 330, 200)]
    else:
        d["legs"] = [((246, 162), (244, 216)), ((250, 166), (250, 222))]
        d["arrows"] = [("Q", 226, 260, 300, 250, 290, 150)]
    d["props"] = [bar_frame(48, 120, 300)]
    return d


def ex_leg_press():
    # reclined seat, feet on a sled that runs on a 45 degree rail
    P = (150, 214)
    t = 150
    N = add(P, t, TORSO)
    k = (196, 168)
    ft = (246, 150)
    d = dict(N=N, P=P, legs=[((192, 164), (242, 146)), (k, ft)],
             arms=[(add(N, 300, 30), (150, 206)), (add(N, 304, 30), (154, 208))])
    rail_a, rail_b = (230, 236), (360, 106)
    plat = (ft[0] + 8, ft[1] + 2)
    d["props"] = [
        seg((116, 222), (186, 222), PROP, 12),
        seg((116, 222), add((116, 222), t, 100), PROP, 12),
        seg((150, 228), (150, G + 6), PROP, 7),
        seg(rail_a, rail_b, PROP, 7),
        seg(rail_a, (230, G + 6), PROP, 7),
        seg(add(plat, 135, 30), add(plat, 315, 30), PROP, 10),
        seg(add(plat, 315, 10), (282, 182), PROP, 6),
        seg((110, G + 6), (370, G + 6), PROP, 7),
    ]
    d["arrows"] = [("L", 270, 110, 320, 60, True)]
    return d


def ex_leg_extension():
    P = (170, 196)
    d = body(P, 94, [(358, 286), (0, 14)], [(282, 300), (286, 304)])
    ft = foot(d)
    d["props"] = [seg((130, 206), (220, 206), PROP, 12), seg((136, 206), (130, 110), PROP, 12),
                  seg((176, 212), (176, G + 6), PROP, 8), seg((130, G + 6), (230, G + 6), PROP, 7),
                  seg(d["legs"][1][0], add(d["legs"][1][0], 14, 52), PROP, 5)]
    d["front"] = [f'<circle cx="{f(ft[0] - 2)}" cy="{f(ft[1] + 14)}" r="9" fill="{IRON_IN}" stroke="{IRON}" stroke-width="5"/>']
    d["arrows"] = [("Q", 264, 270, 316, 240, 312, 180)]
    return d


def ex_ham_curl():
    P = (216, 196)
    d = body(P, 180, [(0, 92), (2, 100)], [(220, 250), (226, 254)], H=(118, 182))
    ft = foot(d)
    d["props"] = [seg((80, 212), (300, 212), PROP, 12), seg((120, 218), (120, G + 6), PROP, 7),
                  seg((260, 218), (260, G + 6), PROP, 7)]
    d["front"] = [f'<circle cx="{f(ft[0] + 10)}" cy="{f(ft[1] + 8)}" r="9" fill="{IRON_IN}" stroke="{IRON}" stroke-width="5"/>']
    d["arrows"] = [("Q", 340, 190, 340, 120, 290, 110)]
    return d


def ex_preacher(machine=False):
    P = (150, 206)
    d = seated([(0, 0), (0, 0)], P=P, t=84)
    N = d["N"]
    e = (N[0] + 36, N[1] + 26)
    h = add(e, 52, FARM)
    d["arms"] = [(e, h), (e, h)]
    pad_a, pad_b = add(e, 145, 36), add(e, 325, 10)
    d["props"] = [seg((add(pad_a, 270, 8)), (add(pad_b, 270, 8)), PROP, 12),
                  seg((e[0] - 6, e[1] + 14), (e[0] + 4, G + 6), PROP, 7),
                  seg((110, 214), (180, 214), PROP, 10), seg((150, 220), (150, G + 6), PROP, 7),
                  seg((110, G + 6), (230, G + 6), PROP, 7)]
    if machine:
        d["props"].append(tower(320))
        d["back"] = [seg(e, h, IRON, 6), cable((316, 40), add(h, 52, 6)), pulley((316, 40))]
        d["props"].append(seg((316, 34), (320, 34), PROP, 8))
        d["front"] = [handle(h, 142, 18)]
    else:
        d["front"] = [plate(h, 20)]
    d["arrows"] = [("Q", e[0] + 56, e[1] + 26, e[0] + 84, e[1] - 20, e[0] + 46, e[1] - 60)]
    return d


def ex_pulldown(kind="front"):
    P = (192, 206)
    if kind == "front":
        d = seated([(78, 84), (80, 86)], P=P, t=100)
    elif kind == "neck":
        d = seated([(110, 300), (114, 304)], P=P, t=84)
    elif kind == "underhand":
        d = seated([(268, 62), (272, 66)], P=P, t=100)
    else:
        d = seated([(250, 50), (254, 54)], P=P, t=104)
    h = hand(d)
    top = (h[0], 30)
    d["props"] = [seg((120, 24), (h[0] + 40, 24), PROP, 8), seg((120, 24), (120, G + 6), PROP, 9),
                  seg((150, 214), (232, 214), PROP, 10), seg((192, 220), (192, G + 6), PROP, 7),
                  seg((222, 178), (246, 178), PROP, 10), seg((120, G + 6), (240, G + 6), PROP, 7)]
    d["back"] = [pulley(top), cable(top, h)]
    d["front"] = [f'<circle cx="{f(h[0])}" cy="{f(h[1])}" r="7" fill="{IRON}"/>']
    d["arrows"] = [("L", 300, 60, 300, 150)]
    return d


def ex_seated_row(kind="neutral"):
    P = (140, 230)
    d = body(P, 92, [(8, 350), (12, 352)], [(250, 4), (246, 0)])
    h = hand(d)
    pul = (334, 236)
    d["props"] = [seg((96, 238), (180, 238), PROP, 10), seg((140, 244), (140, G + 6), PROP, 7),
                  seg((276, 204), (284, G + 6), PROP, 9), tower(346)]
    d["back"] = [pulley(pul), cable(pul, h)]
    d["front"] = [handle(h, 90, 18) if kind == "neutral" else f'<circle cx="{f(h[0])}" cy="{f(h[1])}" r="7" fill="{IRON}"/>']
    d["arrows"] = [("L", 300, 150, 196, 150)]
    return d


def ex_machine_row():
    P = (176, 206)
    d = seated([(220, 4), (216, 0)], P=P, t=88)
    h = hand(d)
    d["props"] = [seg((140, 214), (210, 214), PROP, 10), seg((176, 220), (176, G + 6), PROP, 7),
                  seg((228, 130), (228, 196), PROP, 12), seg((228, 196), (238, G + 6), PROP, 7),
                  seg((270, 60), (270, G + 6), PROP, 9), seg((228, 160), (270, 160), PROP, 6),
                  seg((140, G + 6), (290, G + 6), PROP, 7)]
    d["front"] = [handle(h, 90, 18)]
    d["arrows"] = [("L", 320, 110, 230, 110)]
    return d


# ---- floor and abs
def ex_plank(kind="forearm"):
    if kind == "forearm":
        d = plank_forearm()
        d["arrows"] = [("L", 96, 214, 262, 172, True)]
    elif kind == "side":
        d = dict(N=(252, 196), P=(172, 222),
                 legs=[((128, 238), (86, 254)), ((132, 236), (90, 250))],
                 arms=[((252, 256), (292, 256)), ((254, 160), (256, 118))])
        d["arrows"] = [("L", 172, 206, 172, 160)]
    elif kind == "scissors":
        d = pushup()
        d["legs"] = [((128, 240), (86, 256)), ((130, 236), (90, 226))]
        d["arrows"] = [("Q", 70, 260, 50, 236, 72, 210, True)]
    elif kind == "hip":
        d = plank_forearm()
        d["arrows"] = [("Q", 150, 196, 172, 160, 196, 196, True)]
    elif kind == "switch":
        d = plank_forearm()
        d["arms"][1] = ((256, 236), (258, G))
        d["arrows"] = [("L", 320, 250, 320, 190, True)]
    elif kind == "leg":
        d = plank_forearm()
        d["legs"][1] = ((130, 220), (84, 200))
        d["arrows"] = [("L", 60, 250, 60, 190)]
    return d


def ex_pushup(kind="floor"):
    if kind in ("bench", "close_bench", "plyo"):
        d = dict(N=(250, 168), P=(172, 212),
                 legs=[((130, 236), (88, 258)), ((134, 238), (92, G))],
                 arms=[((250, 184), (264, 196)), ((254, 186), (270, 196))])
        d["props"] = [bench(250, 340, 196)]
        if kind == "close_bench":
            d["arms"] = [((240, 186), (258, 196)), ((244, 188), (262, 196))]
        d["arrows"] = [("L", 196, 100, 196, 160, True)]
        if kind == "plyo":
            d = shift(d, 0, 0)
            d["arms"] = [((262, 176), (276, 162)), ((266, 178), (282, 164))]
            d["arrows"] = [("L", 300, 150, 300, 80)]
            d["lines"] = [seg((262, 182), (290, 182), FAR, 3)]
        return d
    d = pushup()
    if kind == "close":
        d["arms"] = [((244, 232), (248, G)), ((246, 232), (250, G))]
    if kind == "wide":
        d["front"] = [seg((226, G + 2), (292, G + 2), FAR, 4)]
        d["lines"] = [arrow(("L", 210, 290, 300, 290, True))]
    if kind == "clap":
        d = dict(N=(252, 176), P=(170, 214),
                 legs=[((128, 236), (86, 256)), ((130, 238), (90, 258))],
                 arms=[((262, 206), (268, 230)), ((264, 208), (270, 232))])
        d["arrows"] = [("L", 320, 240, 320, 160)]
        d["lines"] = [seg((280, 222), (296, 214), FAR, 3), seg((282, 236), (300, 236), FAR, 3)]
        return d
    if kind == "bag":
        d["props"] = [bag((254, 250))]
        d["N"] = (252, 186)
        d["P"] = (170, 218)
        d["arms"] = [((248, 218), (252, 240)), ((254, 218), (258, 240))]
    d["arrows"] = d.get("arrows", []) + [("L", 330, 165, 330, 240, True)]
    return d


def ex_floor_legs(kind):
    """Lying on the back, legs moving."""
    arms = [(330, 0), (334, 0)]
    if kind == "scissor":
        d = floor_back(arms, [(10, 8), (356, 356)])
        d["arrows"] = [("Q", 300, 270 - 70, 340, 236, 300, 268 - 22, True)]
        d["arrows"] = [("L", 346, 200, 346, 250, True)]
    elif kind == "vertical":
        d = floor_back(arms, [(20, 20), (4, 4)])
        d["arrows"] = [("L", 346, 170, 346, 240, True)]
    elif kind == "flutter":
        d = floor_back(arms, [(8, 8), (2, 2)])
        d["arrows"] = [("L", 346, 200, 346, 246, True)]
        d["lines"] = [speed(380, 206, 3, 20, 10)]
    elif kind == "swing":
        d = floor_back([(184, 180), (176, 180)], [(86, 86), (90, 90)])
        d["arrows"] = [("Q", 290, 110, 230, 60, 170, 110, True)]
    return d


def ex_toe_touch(bent=False):
    if bent:
        d = floor_back([(40, 20), (44, 24)], [(70, 0), (74, 0)], t=150)
    else:
        d = floor_back([(60, 70), (64, 72)], [(88, 88), (90, 90)], t=154)
    d["arrows"] = [("Q", 120, 200, 110, 140, 160, 120)]
    return d


def ex_crunch(kind="crunch"):
    if kind == "crunch":
        d = floor_back([(120, 300), (116, 296)], [(55, 290), (58, 292)], t=154)
        d["arrows"] = [("Q", 110, 236, 90, 200, 120, 166)]
    elif kind == "bent":
        d = floor_back([(10, 0), (14, 4)], [(70, 0), (72, 2)], t=150)
        d["arrows"] = [("Q", 110, 236, 90, 200, 120, 166)]
    elif kind == "opposite":
        d = floor_back([(120, 300), (20, 330)], [(55, 290), (110, 0)], t=146)
        d["arrows"] = [("Q", 110, 236, 90, 200, 120, 166)]
    elif kind == "situp":
        d = floor_back([(330, 120), (334, 124)], [(50, 296), (52, 298)], t=120)
        d["front"] = [plate(hand(d), 20)]
        d["arrows"] = [("Q", 90, 250, 70, 190, 120, 140)]
    elif kind == "jackknife_bench":
        P = (160, 196)
        d = body(P, 120, [(14, 290), (16, 292)], [(240, 270), (244, 272)])
        d["arms"] = [(add(d["N"], 220, UARM), (110, 202)), (add(d["N"], 224, UARM), (114, 202))]
        d["props"] = [bench(90, 200, 202)]
        d["arrows"] = [("L", 300, 170, 230, 150, True)]
    elif kind == "jackknife_bent":
        d = floor_back([(30, 10), (34, 14)], [(80, 0), (84, 2)], t=148)
        d["arrows"] = [("Q", 110, 236, 90, 200, 120, 166)]
    return d


def ex_cross_body():
    # front view: right knee comes up, left elbow comes across to meet it
    d = dict(N=(200, 98), P=(200, 170),
             legs=[((196, 216), (192, G)), ((228, 160), (222, 212))],
             arms=[((214, 140), (182, 92)), ((236, 82), (214, 64))])
    d["arrows"] = [("Q", 150, 120, 160, 170, 206, 182)]
    return d


def ex_single_leg_dl():
    # standing on the near leg, torso tipped forward, far leg straight back
    N, P = (262, 146), (190, 154)
    d = dict(N=N, P=P,
             legs=[((136, 148), (84, 140)), ((196, 208), (194, G))],
             arms=[((262, 180), (262, 210)), ((268, 180), (270, 212))])
    d["back"] = [dumbbell((262, 214), 0, 24)]
    d["front"] = [dumbbell((270, 216), 0, 24)]
    d["arrows"] = [("Q", 320, 190, 340, 120, 280, 90)]
    return d


# ---------------------------------------------------------------- table
EXERCISES = {
    "Bench press": lambda: ex_bench_press(),
    "Deadlift, conventional stance": lambda: ex_deadlift("bar"),
    "Box squat, dumbbell held at chest": lambda: ex_squat("chest", box_=True),
    "Close-grip bench press": lambda: ex_bench_press(close=True),
    "Romanian deadlift, dumbbells": lambda: ex_deadlift("db", stiff=False),
    "Incline dumbbell press": lambda: ex_bench_press(incline=35, dumbbells=True),
    "Dumbbell curl, standing": lambda: ex_curl("db"),
    "Plank": lambda: ex_plank("forearm"),
    "Back extension": lambda: ex_back_extension(),
    "Lateral raise, dumbbells, standing": lambda: ex_lateral(),
    "Box squat, plate held out in front": lambda: ex_squat("plate_front", box_=True),
    "Plank side scissors": lambda: ex_plank("scissors"),
    "Incline bench press": lambda: ex_bench_press(incline=35),
    "Scissor kicks": lambda: ex_floor_legs("scissor"),
    "Vertical scissor kicks": lambda: ex_floor_legs("vertical"),
    "Hammer curl, dumbbells": lambda: ex_curl("db", hammer=True),
    "Leg press machine": lambda: ex_leg_press(),
    "Jackknife, supported on bench": lambda: ex_crunch("jackknife_bench"),
    "One-arm dumbbell snatch": lambda: ex_snatch(),
    "Side plank": lambda: ex_plank("side"),
    "Push-up, hands on bench": lambda: ex_pushup("bench"),
    "Supinated dumbbell curl, standing": lambda: ex_curl("db"),
    "Hamstring curl machine": lambda: ex_ham_curl(),
    "Crunch": lambda: ex_crunch("crunch"),
    "Single-leg dumbbell deadlift": lambda: ex_single_leg_dl(),
    "Vertical toe touches": lambda: ex_toe_touch(),
    "EZ-bar curl": lambda: ex_curl("bar"),
    "Bench dips, straight legs": lambda: ex_bench_dips(True),
    "Hanging diagonal knee raise": lambda: ex_hang("knees"),
    "Dumbbell flyes, flat bench": lambda: ex_bench_press(fly=True),
    "Dumbbell good morning": lambda: ex_good_morning("db"),
    "Close-grip push-up": lambda: ex_pushup("close"),
    "Reverse lunge": lambda: ex_lunge("reverse"),
    "Reverse-grip cable pushdown": lambda: ex_pushdown("bar"),
    "Box squat, dumbbells": lambda: ex_squat("sides", box_=True),
    "Flat dumbbell press": lambda: ex_bench_press(dumbbells=True),
    "Lat pulldown, front, wide grip": lambda: ex_pulldown("front"),
    "Bench dips, feet close to body": lambda: ex_bench_dips(False),
    "Standing dumbbell shoulder press": lambda: ex_shoulder_press("db"),
    "Barbell squat": lambda: ex_squat("back_bar"),
    "Good morning, barbell": lambda: ex_good_morning("bar"),
    "Overhead dumbbell triceps press, neutral grip": lambda: ex_overhead_ext("db"),
    "Stiff-leg dumbbell deadlift": lambda: ex_deadlift("db", stiff=True),
    "Box squat, plate overhead": lambda: ex_squat("overhead", box_=True),
    "Front squat, barbell": lambda: ex_squat("front_bar"),
    "Zercher squat, kettlebell": lambda: ex_squat("zercher"),
    "Wall sit, narrow stance": lambda: ex_wall_sit(),
    "Bench dips": lambda: ex_bench_dips(False),
    "Standing barbell shoulder press": lambda: ex_shoulder_press("bar"),
    "Arnold press, standing": lambda: ex_shoulder_press("db", arnold=True),
    "Bent-knee jackknife with toe touch": lambda: ex_crunch("jackknife_bent"),
    "Cable flyes, low pulley": lambda: ex_cable_fly(low=True),
    "Cable curl, T-bar, low pulley": lambda: ex_cable_curl(),
    "Box squat, bodyweight": lambda: ex_squat("none", box_=True),
    "One-arm dumbbell row": lambda: ex_row("one_arm"),
    "Preacher curl, EZ bar": lambda: ex_preacher(),
    "Box squat, single dumbbell": lambda: ex_squat("between", box_=True),
    "Straight-bar cable pushdown, standing": lambda: ex_pushdown("bar"),
    "One-arm lateral raise, cable": lambda: ex_lateral(cable_=True),
    "Hanging leg raise": lambda: ex_hang("legs"),
    "Plank with hip rotation": lambda: ex_plank("hip"),
    "Crunch to opposite knee": lambda: ex_crunch("opposite"),
    "One-arm front raise, cable": lambda: ex_front_raise(cable_=True),
    "Bar pull to chest, wide grip": lambda: ex_pulldown("chest"),
    "Broad jumps": lambda: ex_broad_jump(),
    "Static lunge": lambda: ex_lunge("static"),
    "Cross-body elbow to knee": lambda: ex_cross_body(),
    "Cable flyes, high pulley": lambda: ex_cable_fly(low=False),
    "Sumo deadlift": lambda: ex_sumo_deadlift(),
    "Overhead rope extension": lambda: ex_overhead_rope(),
    "Front squat, dumbbell": lambda: ex_squat("front_db"),
    "Incline dumbbell flyes": lambda: ex_bench_press(incline=35, fly=True),
    "Bodyweight squat": lambda: ex_squat("none"),
    "Bent-over rope row, cable": lambda: ex_row("rope"),
    "Step-ups on bench": lambda: ex_step_up(),
    "Steep incline bench press": lambda: ex_bench_press(incline=55),
    "Leg extension machine": lambda: ex_leg_extension(),
    "Side lunge": lambda: ex_side_lunge(),
    "Biceps curl machine": lambda: ex_preacher(machine=True),
    "Overhead barbell triceps press": lambda: ex_overhead_ext("bar"),
    "Machine row": lambda: ex_machine_row(),
    "Vertical jump": lambda: ex_jump_squat(vertical=True),
    "Flutter kicks": lambda: ex_floor_legs("flutter"),
    "Seated cable row, neutral grip": lambda: ex_seated_row("neutral"),
    "Lat pulldown, behind the neck": lambda: ex_pulldown("neck"),
    "Wide push-ups": lambda: ex_pushup("wide"),
    "Dumbbell triceps kickback": lambda: ex_kickback(),
    "Front raise, dumbbells": lambda: ex_front_raise(),
    "Squat hold, narrow stance": lambda: ex_bw_squat(narrow_hold=True),
    "Sumo squat, bodyweight": lambda: ex_sumo("bw"),
    "Bent-knee toe touches": lambda: ex_toe_touch(bent=True),
    "Seated cable row, straight bar": lambda: ex_seated_row("bar"),
    "Bar pull to chest, underhand shoulder-width grip": lambda: ex_pulldown("underhand"),
    "Side-to-side jump tucks": lambda: ex_jump_tuck(),
    "Close-grip push-up, hands on bench": lambda: ex_pushup("close_bench"),
    "Hammer curl with pause": lambda: X(ex_curl("db", mid_=True, hammer=True), lines=[pause_mark(300, 60)]),
    "Bent-knee crunch": lambda: ex_crunch("bent"),
    "Front barbell shoulder press, standing": lambda: ex_shoulder_press("bar"),
    "Seated dumbbell triceps press": lambda: ex_overhead_ext("one", seated_=True),
    "Parallel bar dips": lambda: ex_bench_dips(bars=True),
    "Cable curl, low pulley": lambda: ex_cable_curl(),
    "Rope pushdown, standing": lambda: ex_pushdown("rope"),
    "Plank with hand switches": lambda: ex_plank("switch"),
    "Plank with leg lift": lambda: ex_plank("leg"),
    "Incline plyo push-up": lambda: ex_pushup("plyo"),
    "Close push-up, Bulgarian bag": lambda: ex_pushup("bag"),
    "Jump squat": lambda: ex_jump_squat(),
    "Reverse-grip cable row, standing": lambda: ex_row("reverse"),
    "Bent-over dumbbell row": lambda: ex_row("bent"),
    "Bulgarian split squat, dumbbells": lambda: ex_lunge("bulgarian"),
    "Barbell curl, standing": lambda: ex_curl("bar"),
    "Dumbbell deadlift": lambda: ex_deadlift("db"),
    "Close push-up with clap": lambda: ex_pushup("clap"),
    "Seated sit-up with plate": lambda: ex_crunch("situp"),
    "Side leg swings": lambda: ex_floor_legs("swing"),
    "Cross-back lunge with toe touch": lambda: ex_cross_lunge(),
    "Jumping jacks": lambda: ex_jacks(),
    "Sumo squat, dumbbells": lambda: ex_sumo("db"),
    "Upright row, dumbbells, standing": lambda: ex_upright_row(),
    "Bent-over reverse flyes": lambda: ex_reverse_fly(),
}


def ex_cable_fly(low=True):
    d = stand([(0, 20), (4, 24)] if low else [(320, 330), (316, 326)], x=190, legs=((266, 272), (280, 268)), lean=86)
    h = hand(d)
    pul = (340, G - 6) if low else (340, 40)
    d["props"] = [tower(352, 30)]
    d["back"] = [pulley(pul), cable(pul, h)]
    d["front"] = [handle(h, 90, 18)]
    if low:
        d["arrows"] = [("Q", 300, 210, 300, 160, 268, 130)]
    else:
        d["arrows"] = [("Q", 290, 90, 300, 140, 270, 180)]
    return d


# ---------------------------------------------------------------- no-gym (travel) exercises
def chair(x1, x2, seat=196, back="left"):
    """Side view of a chair; the backrest rises from the `back` end of the seat."""
    bx = x1 if back == "left" else x2
    return "".join([seg((x1, seat), (x2, seat), PROP, 8),
                    seg((x1 + 4, seat), (x1 + 4, G + 6), PROP, 6),
                    seg((x2 - 4, seat), (x2 - 4, G + 6), PROP, 6),
                    seg((bx, seat), (bx, seat - 76), PROP, 7)])


def table(x1, x2, top=140):
    return (seg((x1, top), (x2, top), PROP, 10) +
            seg((x1 + 10, top), (x1 + 10, G + 6), PROP, 7) + seg((x2 - 10, top), (x2 - 10, G + 6), PROP, 7))


def post(x, top=36):
    return seg((x, top), (x, G + 6), PROP, 10) + seg((x - 16, G + 6), (x + 16, G + 6), PROP, 7)


def towel(a, b):
    """A towel held as a loop: two soft parallel strands."""
    return seg((a[0], a[1] - 4), (b[0], b[1] - 4), IRON, 5) + seg((a[0], a[1] + 4), (b[0], b[1] + 4), IRON, 5)


def ng_decline():
    d = dict(N=(252, 208), P=(172, 200),
             legs=[((130, 194), (88, 188)), ((132, 196), (92, 190))],
             arms=[((248, 236), (248, G)), ((256, 236), (258, G))])
    d["props"] = [chair(40, 110, 196, "left")]
    d["arrows"] = [("L", 320, 170, 320, 240, True)]
    return d


def ng_archer():
    d = dict(N=(244, 222), P=(164, 236),
             legs=[((122, 246), (80, 256)), ((124, 248), (84, 258))],
             arms=[((234, 244), (244, G)), ((278, 250), (316, G))])
    d["arrows"] = [("Q", 214, 176, 262, 150, 310, 176, True)]
    return d


def ng_chair_dips():
    d = ex_bench_dips(False)
    d["props"] = [chair(34, 118, 200, "left")]
    return d


def ng_diamond():
    d = ex_pushup("close")
    x = 249
    d["lines"] = d.get("lines", []) + [
        f'<polygon points="{x},{G - 26} {x + 10},{G - 16} {x},{G - 6} {x - 10},{G - 16}" fill="none" stroke="{FAR}" stroke-width="3"/>']
    return d


def ng_pike():
    d = dict(N=(246, 188), P=(184, 118),
             legs=[((148, 190), (112, G)), ((150, 192), (116, G))],
             arms=[((258, 224), (272, G)), ((264, 224), (280, G))])
    d["arrows"] = [("L", 330, 160, 330, 236, True)]
    return d


def ng_shoulder_taps():
    d = pushup()
    d["arms"][1] = ((280, 222), (258, 202))
    d["arrows"] = [("Q", 312, 250, 318, 196, 274, 176)]
    return d


def ng_yt():
    d = dict(N=(270, 242), P=(196, 248), H=(294, 232),
             legs=[((150, 250), (104, 254)), ((152, 252), (108, 257))],
             arms=[((304, 228), (340, 212)), ((306, 234), (342, 220))])
    d["arrows"] = [("L", 352, 198, 352, 146)]
    return d


def ng_table_row():
    d = dict(N=(272, 196), P=(184, 222),
             legs=[((136, 238), (90, 254)), ((138, 240), (94, G))],
             arms=[((268, 168), (282, 146)), ((274, 170), (288, 146))])
    d["H"] = (296, 186)
    d["props"] = [table(150, 300, 140)]
    d["arrows"] = [("L", 352, 236, 352, 160)]
    return d


def ng_towel_row():
    d = dict(N=(214, 106), P=(250, 170),
             legs=[((270, 216), (292, G)), ((276, 216), (298, G))],
             arms=[((256, 114), (300, 122)), ((258, 120), (302, 128))])
    d["H"] = (200, 84)
    d["props"] = [post(334)]
    d["back"] = [towel((300, 124), (334, 124))]
    d["arrows"] = [("Q", 140, 150, 150, 90, 210, 58)]
    return d


def ng_superman():
    d = dict(N=(270, 238), P=(196, 246), H=(292, 226),
             legs=[((150, 238), (106, 222)), ((152, 242), (108, 228))],
             arms=[((306, 226), (342, 212)), ((308, 232), (344, 220))])
    d["arrows"] = [("L", 344, 196, 344, 150), ("L", 104, 206, 104, 160)]
    return d


def ng_towel_curl():
    d = dict(N=(168, 118), P=(172, 192),
             legs=[((224, 198), (224, G)), ((226, 194), (262, 226))],
             arms=[((174, 152), (202, 130)), ((178, 154), (206, 134))])
    d["props"] = [chair(120, 196, 200, "left")]
    d["front"] = [towel((206, 134), (264, 228))]
    d["arrows"] = [("Q", 244, 170, 262, 120, 226, 96)]
    return d


def ng_door_curl():
    d = dict(N=(196, 112), P=(238, 176),
             legs=[((260, 220), (280, G)), ((264, 220), (286, G))],
             arms=[((206, 150), (214, 182)), ((248, 122), (296, 132))])
    d["H"] = (182, 90)
    d["props"] = [post(304)]
    d["arrows"] = [("Q", 120, 120, 140, 60, 210, 50)]
    return d


def ng_rfe():
    d = ex_lunge("bulgarian")
    d["props"] = [chair(56, 148, 202, "left")]
    d.pop("back", None)
    d.pop("front", None)
    return d


def ng_step_up():
    d = ex_step_up()
    d["props"] = [chair(240, 320, 196, "right")]
    return d


def ng_glute_bridge(single=True):
    d = dict(N=(125, 250), P=(202, 204), H=(100, 244),
             legs=[((242, 196), (250, G)), ((248, 186), (296, 168)) if single else ((246, 198), (254, G))],
             arms=[((160, 260), (196, 262)), ((164, 262), (200, 264))])
    d["arrows"] = [("L", 202, 186, 202, 130)]
    return d


def ng_ham_slide():
    d = dict(N=(125, 250), P=(206, 214), H=(100, 244),
             legs=[((250, 222), (286, G - 2)), ((254, 224), (292, G - 2))],
             arms=[((160, 260), (196, 262)), ((164, 262), (200, 264))])
    d["props"] = [seg((272, G + 3), (310, G + 3), IRON, 7)]
    d["arrows"] = [("L", 240, 292, 350, 292, True)]
    return d


def ng_hip_hinge():
    d = ex_single_leg_dl()
    d.pop("back", None)
    d.pop("front", None)
    d["arms"] = [((270, 176), (284, 204)), ((276, 176), (292, 204))]
    return d


def ng_dead_bug():
    return dict(N=(150, 244), P=(222, 244), H=(124, 242),
                legs=[((222, 196), (266, 196)), ((268, 230), (314, 234))],
                arms=[((150, 206), (150, 168)), ((120, 222), (88, 210))],
                arrows=[("Q", 92, 176, 64, 186, 70, 216), ("Q", 300, 196, 330, 202, 336, 226)])


def ng_mountain():
    d = pushup()
    d["legs"] = [((128, 240), (86, 256)), ((214, 222), (184, 252))]
    d["lines"] = [speed(78, 196, 3, 30, 12)]
    d["arrows"] = [("L", 112, 290, 214, 290, True)]
    return d


def ng_leg_raise():
    d = floor_back([(186, 180), (182, 180)], [(62, 62), (66, 66)])
    d["arrows"] = [("Q", 340, 240, 350, 150, 290, 100)]
    return d


NOGYM_DRAW = {
    "Push-up": lambda: ex_pushup("floor"),
    "Decline push-up, feet on a chair": ng_decline,
    "Archer push-up": ng_archer,
    "Chair dips": ng_chair_dips,
    "Diamond push-up": ng_diamond,
    "Pike push-up": ng_pike,
    "Plank shoulder taps": ng_shoulder_taps,
    "Floor Y-T raises": ng_yt,
    "Table row": ng_table_row,
    "Towel row": ng_towel_row,
    "Superman raise": ng_superman,
    "Towel curl": ng_towel_curl,
    "Door-frame curl": ng_door_curl,
    "Split squat": lambda: ex_lunge("static"),
    "Rear-foot-elevated split squat, chair": ng_rfe,
    "Chair step-up": ng_step_up,
    "Wall sit": ex_wall_sit,
    "Single-leg glute bridge": ng_glute_bridge,
    "Towel hamstring slide": ng_ham_slide,
    "Single-leg hip hinge": ng_hip_hinge,
    "Forearm plank": lambda: ex_plank("forearm"),
    "Dead bug": ng_dead_bug,
    "Mountain climbers": ng_mountain,
    "Lying leg raise": ng_leg_raise,
}


PLACEHOLDER = ("new-exercise", "New exercise", lambda: stand([(150, 120), (30, 60)]))


def seed_names():
    """Exercise names straight from the SEED data in index.html."""
    import json
    src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    m = re.search(r"const SEED = (\{.*?\});\n", src)
    return [e[0] for e in json.loads(m.group(1))["ex"]]


def nogym_names():
    """No-gym exercise names from the NOGYM list in index.html."""
    import json
    src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    m = re.search(r"const NOGYM = (\[.*?\]);\n", src)
    return [e["name"] for e in json.loads(m.group(1))]


def main():
    os.makedirs(OUT, exist_ok=True)
    names = seed_names()
    ng = nogym_names()
    missing = [n for n in names if n not in EXERCISES] + [n for n in ng if n not in NOGYM_DRAW]
    if missing:
        sys.exit("No drawing for: " + ", ".join(missing))
    written = []
    for n in names:
        s = slug(n)
        with open(os.path.join(OUT, s + ".svg"), "w", encoding="utf-8") as fh:
            fh.write(svg(n, EXERCISES[n]()))
        written.append(s)
    for n in ng:
        s = slug(n)
        if s in written:
            sys.exit("Name clash with a gym exercise: " + n)
        with open(os.path.join(OUT, s + ".svg"), "w", encoding="utf-8") as fh:
            fh.write(svg(n, NOGYM_DRAW[n]()))
        written.append(s)
    s, title, fn = PLACEHOLDER
    with open(os.path.join(OUT, s + ".svg"), "w", encoding="utf-8") as fh:
        fh.write(svg(title, dict(fn(), arrows=[])))
    print(f"wrote {len(written) + 1} images to {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
