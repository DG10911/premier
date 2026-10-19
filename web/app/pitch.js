/* ROAR — real-3D canvas pitch.
 * A true perspective camera projects a 105x68 m pitch. Turf, mown stripes,
 * markings, floodlight pools, shot map, and 3D player discs (raised puck +
 * ground shadow) are all drawn with depth sorting. Players drift toward the
 * ball so the shape lives. No assets, no dependencies.
 *
 * Host contract: window.ROAR_LIVE = { bx, by, possession, shots:[...] }
 */
(function () {
  const cv = document.getElementById('pitch');
  if (!cv) return;
  const g = cv.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const L = 105, Wd = 68;               // metres
  const GOAL_HALF = 3.66;

  let W = 0, H = 0, dpr = 1;
  let cam, focal, cx0, cy0;             // camera + projection fit

  /* ---------------- math ---------------- */
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };

  function basis() {
    const z = norm(sub(cam, [L/2, Wd/2, 0]));      // camera looks down -z toward pitch
    const x = norm(cross([0, 0, 1], z));
    const y = cross(z, x);
    return { x, y, z };
  }
  let B = null;

  function rawProject(p) {
    const v = sub(p, cam);
    const d = -dot(v, B.z);                         // depth in front of camera
    if (d <= 0.001) return null;
    const sx = dot(v, B.x), sy = dot(v, B.y);
    return [cx0 + (sx / d) * focal, cy0 - (sy / d) * focal, d];
  }

  // world metres <- pitch units 0..100
  const toWorld = (x, y, z = 0) => [(LIVE.flip ? (100 - x) : x)/100 * L, y/100 * Wd, z];

  function project(x, y, z) { return rawProject(toWorld(x, y, z)); }

  /* ---------------- camera fit ---------------- */
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = Math.max(320, r.width); H = Math.max(240, r.height);
    cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // elevated camera behind the near touchline, slightly off-centre
    cam = [L * 0.5, -Wd * 0.44, 24];
    B = basis();
    focal = W * 0.8; cx0 = W * 0.5; cy0 = H * 0.50;

    // auto-fit: project the four pitch corners and rescale to fill the panel
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const [ax, ay] of [[0,0],[100,0],[0,100],[100,100]]) {
      const p = project(ax, ay, 0); if (!p) continue;
      minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]);
      miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
    }
    const bw = Math.max(maxx - minx, 1), bh = Math.max(maxy - miny, 1);
    const s = Math.min((W * 1.00) / bw, (H * 1.02) / bh);
    focal *= s;
    cx0 = W * 0.5 - ((minx + maxx) / 2 - cx0) * s;
    cy0 = H * 0.50 - ((miny + maxy) / 2 - cy0) * s;
    // nudge the pitch slightly down so the lower-third graphic doesn't crowd it
    cy0 += H * 0.015;
  }

  /* ---------------- live state ---------------- */
  const LIVE = { bx: 50, by: 50, bz: 0.9, possession: 'home', shots: [], flip: 0, highlight: null };
  window.ROAR_LIVE = LIVE;

  const players = [];
  (function seed() {
    const D = window.ROAR;
    if (!D) return;
    for (const pl of D.players) {
      const h = pl.team === 'home';
      const bx = h ? pl.base_x : 100 - pl.base_x;
      const by = h ? pl.base_y : 100 - pl.base_y;
      players.push({ h, bx, by, x: bx, y: by, t: cnt(pl.team, h) });
    }
    function cnt(team, h) { return 0; }
  })();

  /* ---------------- drawing ---------------- */
  function poly(pts, fill, stroke, lw) {
    if (pts.length < 2) return;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); }
  }

  function path(pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  }

  function line(a, b, color, lw) {
    const p = project(a[0], a[1], 0), q = project(b[0], b[1], 0);
    if (!p || !q) return;
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
    g.strokeStyle = color; g.lineWidth = lw || 1.6; g.stroke();
  }

  function arc(cx, cy, r, color, lw, a0, a1) {
    const N = 64, pts = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + (a1 - a0) * (i / N);
      const p = project(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0);
      if (p) pts.push(p);
    }
    if (pts.length < 2) return;
    path(pts); g.strokeStyle = color; g.lineWidth = lw || 1.6; g.stroke();
  }

  function rect(x0, y0, x1, y1, color, lw) {
    line([x0, y0], [x1, y0], color, lw);
    line([x1, y0], [x1, y1], color, lw);
    line([x1, y1], [x0, y1], color, lw);
    line([x0, y1], [x0, y0], color, lw);
  }

  function drawTurf() {
    // mown stripes across the length
    const strips = 14, sw = 100 / strips;
    for (let i = 0; i < strips; i++) {
      const x0 = i * sw, x1 = x0 + sw;
      const c = i % 2 ? '#176d42' : '#126038';
      poly([project(x0, 0), project(x1, 0), project(x1, 100), project(x0, 100)].filter(Boolean), c);
    }
    // flood pools
    g.save();
    g.globalCompositeOperation = 'screen';
    for (const fx of [0.2, 0.5, 0.8]) {
      const p = project(fx * 100, 50, 0); if (!p) continue;
      const rad = W * 0.34;
      const rg = g.createRadialGradient(p[0], p[1], 10, p[0], p[1], rad);
      rg.addColorStop(0, 'rgba(190,255,220,.20)');
      rg.addColorStop(1, 'rgba(180,255,215,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(p[0], p[1], rad, 0, 7); g.fill();
    }
    // depth falloff toward the far touchline
    const c = project(50, 100, 0), n = project(50, 0, 0);
    if (c && n) {
      const lg = g.createLinearGradient(0, c[1], 0, n[1]);
      lg.addColorStop(0, 'rgba(0,0,0,.30)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg; g.fillRect(0, Math.min(c[1], n[1]) - 10, W, Math.abs(n[1] - c[1]) + 20);
    }
    g.restore();
  }

  const LINE = 'rgba(228,255,238,.72)';
  function drawMarkings() {
    rect(0, 0, 100, 100, LINE, 1.8);
    line([50, 0], [50, 100], LINE, 1.6);
    arc(50, 50, 9.15 / L * 100, LINE, 1.6);
    const p0 = project(50, 50, 0);
    if (p0) { g.beginPath(); g.arc(p0[0], p0[1], 2.4, 0, 7); g.fillStyle = LINE; g.fill(); }

    const penD = 16.5 / L * 100, penW = 40.3 / Wd * 100;
    const sixD = 5.5 / L * 100, sixW = 18.32 / Wd * 100;
    const gy0 = 50 - penW / 2, gy1 = 50 + penW / 2;
    const sy0 = 50 - sixW / 2, sy1 = 50 + sixW / 2;
    rect(0, gy0, penD, gy1, LINE, 1.6);
    rect(100 - penD, gy0, 100, gy1, LINE, 1.6);
    rect(0, sy0, sixD, sy1, LINE, 1.6);
    rect(100 - sixD, sy0, 100, sy1, LINE, 1.6);

    // penalty spots + arcs
    const spL = project(11 / L * 100, 50, 0), spR = project(100 - 11 / L * 100, 50, 0);
    if (spL) { g.beginPath(); g.arc(spL[0], spL[1], 2, 0, 7); g.fillStyle = LINE; g.fill(); }
    if (spR) { g.beginPath(); g.arc(spR[0], spR[1], 2, 0, 7); g.fillStyle = LINE; g.fill(); }
    arc(11 / L * 100, 50, 9.15 / L * 100, LINE, 1.6, -Math.PI / 2.6, Math.PI / 2.6);
    arc(100 - 11 / L * 100, 50, 9.15 / L * 100, LINE, 1.6, Math.PI - Math.PI / 2.6, Math.PI + Math.PI / 2.6);

    // goals
    for (const [gx, dir] of [[0, 1], [100, -1]]) {
      const a = project(gx, 50 - GOAL_HALF / Wd * 100, 0);
      const b = project(gx, 50 + GOAL_HALF / Wd * 100, 0);
      const at = project(gx + dir * 0.6, 50 - GOAL_HALF / Wd * 100, 2.44 / L * 100);
      const bt = project(gx + dir * 0.6, 50 + GOAL_HALF / Wd * 100, 2.44 / L * 100);
      if (a && b && at && bt) {
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(bt[0], bt[1]); g.lineTo(at[0], at[1]); g.closePath();
        g.fillStyle = 'rgba(220,240,255,.10)'; g.fill();
        g.strokeStyle = 'rgba(230,248,255,.85)'; g.lineWidth = 2; g.stroke();
      }
    }
  }

  function drawShots() {
    for (const s of LIVE.shots) {
      const p = project(s.x, s.y, 0.2); if (!p) continue;
      const r = (5 + (s.xg || 0.02) * 34) * (1 + 6 / p[2]);
      const col = s.team === 'home' ? '56,217,240' : '255,166,43';
      g.beginPath(); g.arc(p[0], p[1], r, 0, 7);
      g.fillStyle = `rgba(${col},${s.outcome === 'goal' ? 0.34 : 0.14})`; g.fill();
      g.strokeStyle = `rgba(${col},${s.outcome === 'goal' ? 0.95 : 0.6})`; g.lineWidth = s.outcome === 'goal' ? 2 : 1.2; g.stroke();
      if (s.outcome === 'goal') {
        g.beginPath(); g.arc(p[0], p[1], r * 1.9, 0, 7);
        g.strokeStyle = 'rgba(212,255,63,.5)'; g.lineWidth = 1.4; g.stroke();
      }
    }
  }

  function drawDisc(p, r, fill, ring, lift) {
    // ground shadow
    const sh = project(p.x, p.y, 0);
    if (!sh) return;
    g.beginPath();
    g.ellipse(sh[0], sh[1] + r * 0.45, r * 1.15, r * 0.5, 0, 0, 7);
    g.fillStyle = 'rgba(0,0,0,.42)'; g.fill();

    const top = project(p.x, p.y, lift || 1.15);
    if (!top) return;
    // body (side of the puck)
    g.beginPath();
    g.moveTo(top[0] - r, top[1]);
    g.lineTo(top[0] + r, top[1]);
    g.lineTo(sh[0] + r, sh[1] + r * 0.2);
    g.lineTo(sh[0] - r, sh[1] + r * 0.2);
    g.closePath();
    g.fillStyle = fill.replace('1)', '0.45)'); g.fill();
    // cap
    g.beginPath(); g.arc(top[0], top[1], r, 0, 7);
    g.fillStyle = fill; g.fill();
    if (ring) { g.strokeStyle = ring; g.lineWidth = 1.4; g.stroke(); }
  }

  function drawPlayers() {
    const list = players.map(p => {
      const d = project(p.x, p.y, 1.2);
      return { p, d };
    }).filter(o => o.d).sort((a, b) => b.d[2] - a.d[2]);

    for (const { p, d } of list) {
      const r = Math.max(3.2, 7.5 * (28 / d[2]));
      drawDisc(p, r,
        p.h ? 'rgba(56,217,240,1)' : 'rgba(255,166,43,1)',
        p.h ? 'rgba(200,250,255,.85)' : 'rgba(255,232,190,.85)', 1.15);
    }
  }

  function drawHighlight() {
    const h = LIVE.highlight; if (!h) return;
    const p1 = project(h.x, h.y, 0), p2 = project(h.ex, h.ey, 0);
    if (!p1 || !p2) return;
    g.save();
    g.setLineDash([7, 7]);
    g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]);
    g.strokeStyle = 'rgba(212,255,63,.75)'; g.lineWidth = 2.2; g.stroke();
    g.restore();
    for (const p of [p1, p2]) {
      g.beginPath(); g.arc(p[0], p[1], 13, 0, 7);
      g.strokeStyle = 'rgba(212,255,63,.5)'; g.lineWidth = 1.6; g.stroke();
    }
  }

  function drawBall() {
    const d = project(LIVE.bx, LIVE.by, LIVE.bz || 0.9);
    if (!d) return;
    const r = Math.max(5, 10 * (28 / d[2]));
    const sh = project(LIVE.bx, LIVE.by, 0);
    if (sh) {
      g.beginPath(); g.ellipse(sh[0], sh[1] + r * 0.5, r * 1.25, r * 0.5, 0, 0, 7);
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fill();
    }
    const grd = g.createRadialGradient(d[0] - r * 0.35, d[1] - r * 0.4, r * 0.1, d[0], d[1], r);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.55, '#e8eefb'); grd.addColorStop(1, '#7f8ea6');
    g.beginPath(); g.arc(d[0], d[1], r, 0, 7); g.fillStyle = grd; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.4; g.stroke();
    g.beginPath(); g.arc(d[0], d[1], r * 1.8, 0, 7); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.2; g.stroke();
  }

  /* ---------------- animation ---------------- */
  let last = 0;
  function step(now) {
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05); last = now;

    // players drift toward the ball (both teams shift as a block)
    const pullX = (LIVE.bx - 50) * 0.30;
    const pullY = (LIVE.by - 50) * 0.18;
    for (const p of players) {
      const towardBall = p.h === (LIVE.possession === 'home') ? 0.16 : 0.10;
      const tx = Math.max(2, Math.min(98, p.bx + pullX + (LIVE.bx - p.bx) * towardBall));
      const ty = Math.max(3, Math.min(97, p.by + pullY + (LIVE.by - p.by) * towardBall));
      const k = REDUCED ? 1 : Math.min(1, dt * 1.6);
      p.x += (tx - p.x) * k; p.y += (ty - p.y) * k;
    }

    g.clearRect(0, 0, W, H);
    drawTurf();
    drawMarkings();
    drawShots();
    drawHighlight();
    drawPlayers();
    drawBall();

    requestAnimationFrame(step);
  }

  addEventListener('resize', resize);
  resize();
  window.ROAR_PITCH = { project: (x, y, z) => project(x, y, z), resize };
  if (REDUCED) {
    g.clearRect(0, 0, W, H); drawTurf(); drawMarkings(); drawPlayers(); drawBall();
    addEventListener('resize', () => { resize(); g.clearRect(0, 0, W, H); drawTurf(); drawMarkings(); drawPlayers(); drawBall(); });
  } else {
    requestAnimationFrame(step);
  }
})();
