/* ROAR — procedural cinematic stadium scene.
 * No image assets, no network, no third-party marks. Everything is drawn.
 * Layers: night sky -> distant city -> upper tier -> lower tier (crowd bokeh)
 *         -> floodlight towers + volumetric beams -> pitch haze.
 * Static layers are pre-rendered to an offscreen canvas; only the beams and
 * crowd shimmer animate, at a throttled rate, and never under reduced motion.
 */
(function () {
  const canvas = document.getElementById('scene');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, DPR = 1;
  let staticLayer = null;
  let crowd = [];
  let beams = [];
  let t0 = performance.now();
  let raf = 0;
  let flash = 0;          // 0..1 goal flash
  let lastDraw = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function size() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function build() {
    const horizon = H * 0.46;

    /* ---------- crowd bokeh ---------- */
    crowd = [];
    const rows = 26;
    for (let r = 0; r < rows; r++) {
      const ry = horizon - 6 - r * (H * 0.0125);
      const span = W * (1.06 + r * 0.012);
      const count = Math.floor(span / 11);
      for (let i = 0; i < count; i++) {
        const x = (W - span) / 2 + (i / count) * span + rand(-4, 4);
        const warm = Math.random();
        crowd.push({
          x, y: ry + rand(-2.5, 2.5),
          r: rand(0.8, 2.4),
          a: rand(0.18, 0.78) * (1 - r / rows * 0.45),
          hue: warm > 0.82 ? '255,196,120' : warm > 0.62 ? '150,200,255' : '190,215,255',
          tw: rand(0, Math.PI * 2),
          sp: rand(0.4, 1.5)
        });
      }
    }

    /* ---------- floodlight beams ---------- */
    beams = [];
    const towerXs = [0.14, 0.34, 0.66, 0.86];
    towerXs.forEach((tx, i) => {
      beams.push({
        x: W * tx,
        y: horizon - H * 0.30,
        len: H * 0.95,
        spread: W * 0.16,
        a: 0.085 + (i % 2) * 0.022,
        phase: rand(0, 6.28),
        speed: rand(0.25, 0.55)
      });
    });

    /* ---------- static layer ---------- */
    staticLayer = document.createElement('canvas');
    staticLayer.width = canvas.width;
    staticLayer.height = canvas.height;
    const s = staticLayer.getContext('2d');
    s.setTransform(DPR, 0, 0, DPR, 0, 0);

    // sky
    const sky = s.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#05070f');
    sky.addColorStop(0.55, '#070d1c');
    sky.addColorStop(1, '#0a1526');
    s.fillStyle = sky;
    s.fillRect(0, 0, W, horizon);

    // distant city glow
    const city = s.createRadialGradient(W * 0.5, horizon, 10, W * 0.5, horizon, W * 0.7);
    city.addColorStop(0, 'rgba(60,110,190,0.16)');
    city.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = city;
    s.fillRect(0, 0, W, horizon);

    // roof line / stand silhouette
    s.beginPath();
    s.moveTo(0, horizon - H * 0.02);
    s.quadraticCurveTo(W * 0.5, horizon - H * 0.13, W, horizon - H * 0.02);
    s.lineTo(W, horizon + 4);
    s.lineTo(0, horizon + 4);
    s.closePath();
    s.fillStyle = '#060b16';
    s.fill();

    // tiers
    for (let r = 0; r < 26; r++) {
      const y = horizon - 6 - r * (H * 0.0125);
      s.fillStyle = `rgba(11,19,34,${0.42 + r * 0.010})`;
      s.fillRect(0, y - 4, W, H * 0.0125 + 2);
    }

    // pitch haze (lower half)
    const pitch = s.createLinearGradient(0, horizon, 0, H);
    pitch.addColorStop(0, 'rgba(10,34,24,0.92)');
    pitch.addColorStop(0.5, 'rgba(6,24,17,0.96)');
    pitch.addColorStop(1, 'rgba(3,12,9,1)');
    s.fillStyle = pitch;
    s.fillRect(0, horizon, W, H - horizon);

    // atmosphere
    const haze = s.createLinearGradient(0, horizon - H * 0.2, 0, horizon + H * 0.25);
    haze.addColorStop(0, 'rgba(80,140,220,0)');
    haze.addColorStop(0.5, 'rgba(90,150,230,0.10)');
    haze.addColorStop(1, 'rgba(80,140,220,0)');
    s.fillStyle = haze;
    s.fillRect(0, horizon - H * 0.2, W, H * 0.45);

    // floodlight towers
    towerXs.forEach((tx) => {
      const x = W * tx, y = horizon - H * 0.30;
      s.strokeStyle = 'rgba(120,150,200,0.20)';
      s.lineWidth = 1.4;
      s.beginPath(); s.moveTo(x, y); s.lineTo(x, horizon - 4); s.stroke();
      // lamp rig
      s.fillStyle = 'rgba(210,230,255,0.55)';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        s.beginPath();
        s.arc(x - 9 + i * 9, y - 5 + j * 7, 1.9, 0, 7);
        s.fill();
      }
      // glow
      const g = s.createRadialGradient(x, y, 1, x, y, 46);
      g.addColorStop(0, 'rgba(190,220,255,0.35)');
      g.addColorStop(1, 'rgba(190,220,255,0)');
      s.fillStyle = g;
      s.beginPath(); s.arc(x, y, 46, 0, 7); s.fill();
    });
  }

  function draw(now) {
    raf = 0;
    if (!staticLayer) return;
    const t = (now - t0) / 1000;

    // throttle to ~30fps for the ambient pass
    if (now - lastDraw < 33) { raf = requestAnimationFrame(draw); return; }
    lastDraw = now;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(staticLayer, 0, 0, W, H);

    const horizon = H * 0.46;

    /* volumetric beams */
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    beams.forEach((b) => {
      const sway = Math.sin(t * b.speed + b.phase) * 0.06;
      const flick = 0.92 + Math.sin(t * 2.1 + b.phase) * 0.08;
      const grad = ctx.createLinearGradient(b.x, b.y, b.x + sway * W, b.y + b.len);
      grad.addColorStop(0, `rgba(200,225,255,${b.a * flick + flash * 0.10})`);
      grad.addColorStop(0.55, `rgba(170,205,255,${b.a * 0.45 * flick})`);
      grad.addColorStop(1, 'rgba(150,190,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(b.x - 7, b.y);
      ctx.lineTo(b.x + 7, b.y);
      ctx.lineTo(b.x + b.spread + sway * W, b.y + b.len);
      ctx.lineTo(b.x - b.spread + sway * W, b.y + b.len);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    /* crowd shimmer */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < crowd.length; i++) {
      const c = crowd[i];
      const tw = 0.72 + Math.sin(t * c.sp * 0.9 + c.tw) * 0.28;
      ctx.fillStyle = `rgba(${c.hue},${(c.a * tw).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, 7);
      ctx.fill();
    }
    ctx.restore();

    /* goal flash wash */
    if (flash > 0.001) {
      const g = ctx.createRadialGradient(W * 0.5, horizon, 10, W * 0.5, horizon, W * 0.8);
      g.addColorStop(0, `rgba(255,214,90,${flash * 0.20})`);
      g.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      flash *= 0.90;
    }

    raf = requestAnimationFrame(draw);
  }

  function start() { if (!raf && !REDUCED) raf = requestAnimationFrame(draw); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  addEventListener('resize', () => { size(); if (REDUCED) drawStatic(); });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());

  function drawStatic() {
    if (!staticLayer) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(staticLayer, 0, 0, W, H);
  }

  size();
  if (REDUCED) drawStatic(); else start();

  window.ROAR_SCENE = {
    flash(strength = 1) { flash = Math.min(1, flash + strength); if (REDUCED) { drawStatic(); } }
  };
})();
