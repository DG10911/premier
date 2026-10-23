/* ROAR — WebGL stadium stage.
 *
 * A real Three.js scene: a 105 x 68 m pitch under floodlights, a full bowl of
 * 35k crowd points that react to goals, LED perimeter boards, goal nets that
 * ripple, 22 players that hold shape and react to the ball, and a camera
 * director that cuts each moment like a broadcast.
 *
 * Every visual is driven by the engine's moment data — the stage never
 * invents an outcome. Haptic cues are rendered as shockwaves on the turf so
 * the "feel" track is visible as well as vibrated.
 *
 * Vendored three.js (MIT) — no network, no build step.
 */
import * as THREE from './vendor/three.bundle.js';

const { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass } = THREE;

const L = 105, W = 68, HL = L / 2, HW = W / 2;
const GOAL_HALF = 3.66, GOAL_H = 2.44;
const COL = {
  home: new THREE.Color('#38d9f0'),
  away: new THREE.Color('#ffa62b'),
  volt: new THREE.Color('#d4ff3f'),
  danger: new THREE.Color('#ff4d6d'),
  white: new THREE.Color('#ffffff'),
};
const FIG_SCALE = 1.45;
const NOPOST = /[?&]nopost/.test(location.search);

const w2 = (x, y) => new THREE.Vector3((x / 100 - 0.5) * L, 0, (y / 100 - 0.5) * W);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// deterministic PRNG so the crowd and flight heights are stable between loads
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

export async function createStage({ canvas, labels, data, reduced = false }) {
  const D = data;
  const R = rng(D.meta.seed || 42);

  /* ------------------------------------------------------------ renderer */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(PR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050a15, 0.0042);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 1500);
  camera.position.set(40, 26, 50);

  /* ------------------------------------------------------------ sky + stars */
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(700, 40, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 top = vec3(0.004,0.008,0.022);
          vec3 hor = vec3(0.03,0.06,0.13);
          vec3 c = mix(hor, top, smoothstep(-0.02, 0.55, h));
          c += vec3(0.07,0.11,0.24) * exp(-abs(h - 0.04) * 16.0) * 0.7;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })));
  {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = R() * Math.PI * 2, ph = Math.acos(lerp(0.18, 0.98, R()));
      pos.set([Math.sin(ph) * Math.cos(th) * 650, Math.cos(ph) * 650, Math.sin(ph) * Math.sin(th) * 650], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, color: 0x9fb8ff, transparent: true, opacity: 0.55, fog: false })));
  }

  /* ------------------------------------------------------------ lighting */
  scene.add(new THREE.HemisphereLight(0x9cb8ff, 0x08130c, 0.38));
  const key = new THREE.DirectionalLight(0xf2f6ff, 1.45);
  key.position.set(-40, 90, 60);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 260 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 3;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.5); fill.position.set(60, 50, -70); scene.add(fill);

  /* ------------------------------------------------------------ pitch */
  const APRON = 4;
  const PW = L + APRON * 2, PH = W + APRON * 2;
  const pitchTex = (() => {
    const ppm = 26, cw = Math.round(PW * ppm), ch = Math.round(PH * ppm);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const X = (x) => (x + PW / 2) * ppm, Z = (z) => (z + PH / 2) * ppm;
    g.fillStyle = '#0f4a2a'; g.fillRect(0, 0, cw, ch);
    const strips = 18, sw = L / strips;
    for (let i = 0; i < strips; i++) {
      g.fillStyle = i % 2 ? '#1c7442' : '#165f36';
      g.fillRect(X(-HL + i * sw), Z(-HW), sw * ppm + 1, W * ppm);
    }
    // cross-mow (very soft)
    g.globalAlpha = 0.06;
    for (let j = 0; j < 12; j++) { if (j % 2) { g.fillStyle = '#000'; g.fillRect(X(-HL), Z(-HW + j * W / 12), L * ppm, W / 12 * ppm); } }
    g.globalAlpha = 1;
    // grain
    const img = g.getImageData(0, 0, cw, ch), d = img.data, r2 = rng(7);
    for (let i = 0; i < d.length; i += 4) {
      const n = (r2() - 0.5) * 18;
      d[i] = clamp(d[i] + n * 0.6, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n * 0.5, 0, 255);
    }
    g.putImageData(img, 0, 0);
    // markings
    g.strokeStyle = 'rgba(245,255,248,0.92)'; g.fillStyle = 'rgba(245,255,248,0.92)';
    g.lineWidth = 0.13 * ppm; g.lineCap = 'round';
    const rect = (x0, z0, x1, z1) => g.strokeRect(X(x0), Z(z0), (x1 - x0) * ppm, (z1 - z0) * ppm);
    const circ = (x, z, r, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.arc(X(x), Z(z), r * ppm, a0, a1); g.stroke(); };
    const dot = (x, z, r) => { g.beginPath(); g.arc(X(x), Z(z), r * ppm, 0, 7); g.fill(); };
    rect(-HL, -HW, HL, HW);
    g.beginPath(); g.moveTo(X(0), Z(-HW)); g.lineTo(X(0), Z(HW)); g.stroke();
    circ(0, 0, 9.15); dot(0, 0, 0.25);
    for (const s of [-1, 1]) {
      const gx = s * HL;
      const pa = 16.5, pw = 20.16, ga = 5.5, gw = 9.16;
      rect(Math.min(gx, gx - s * pa), -pw, Math.max(gx, gx - s * pa), pw);
      rect(Math.min(gx, gx - s * ga), -gw, Math.max(gx, gx - s * ga), gw);
      dot(gx - s * 11, 0, 0.22);
      const a = Math.acos(5.5 / 9.15);
      if (s < 0) circ(gx + 11, 0, 9.15, -a, a); else circ(gx - 11, 0, 9.15, Math.PI - a, Math.PI + a);
      for (const zs of [-1, 1]) circ(gx, zs * HW, 1, 0, Math.PI * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  })();
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.92, metalness: 0 }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; scene.add(pitch);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x07110c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);

  /* ------------------------------------------------------------ goals + nets */
  function netGrid(w, h, nx, ny) {
    const pts = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) { const x = -w / 2 + (i / nx) * w; pts.push(x, -h / 2 + (j / ny) * h, 0, x, -h / 2 + ((j + 1) / ny) * h, 0); }
    for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) { const y = -h / 2 + (j / ny) * h; pts.push(-w / 2 + (i / nx) * w, y, 0, -w / 2 + ((i + 1) / nx) * w, y, 0); }
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(pts);
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.userData.base = arr.slice();
    return g;
  }
  const netMat = new THREE.LineBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.32 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.4 });
  const goals = {};
  for (const s of [-1, 1]) {
    const grp = new THREE.Group(); grp.position.x = s * HL; scene.add(grp);
    const post = new THREE.CylinderGeometry(0.07, 0.07, GOAL_H, 12);
    for (const z of [-GOAL_HALF, GOAL_HALF]) { const p = new THREE.Mesh(post, postMat); p.position.set(0, GOAL_H / 2, z); p.castShadow = true; grp.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, GOAL_HALF * 2 + 0.14, 12), postMat);
    bar.rotation.x = Math.PI / 2; bar.position.y = GOAL_H; bar.castShadow = true; grp.add(bar);
    const DEPTH = 2.2;
    const back = new THREE.LineSegments(netGrid(GOAL_HALF * 2, GOAL_H, 30, 10), netMat);
    back.rotation.y = s * Math.PI / 2; back.position.set(s * DEPTH, GOAL_H / 2, 0); grp.add(back);
    for (const z of [-GOAL_HALF, GOAL_HALF]) {
      const side = new THREE.LineSegments(netGrid(DEPTH, GOAL_H, 9, 10), netMat);
      side.position.set(s * DEPTH / 2, GOAL_H / 2, z); grp.add(side);
    }
    const roof = new THREE.LineSegments(netGrid(DEPTH, GOAL_HALF * 2, 9, 30), netMat);
    roof.rotation.x = -Math.PI / 2; roof.position.set(s * DEPTH / 2, GOAL_H, 0); grp.add(roof);
    goals[s] = { grp, back, ripple: null };
  }
  function rippleNet(s, worldZ, worldY) {
    goals[s].ripple = { t: 0, lx: -s * worldZ, ly: worldY - GOAL_H / 2 };
  }
  function updateNets(dt) {
    for (const s of [-1, 1]) {
      const n = goals[s]; if (!n.ripple) continue;
      n.ripple.t += dt;
      const t = n.ripple.t, A = 1.25 * Math.exp(-t * 2.4) * Math.cos(t * 9);
      const pos = n.back.geometry.attributes.position, base = n.back.geometry.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const d2 = (x - n.ripple.lx) ** 2 + (y - n.ripple.ly) ** 2;
        pos.array[i * 3 + 2] = A * Math.exp(-d2 / 2.2);
      }
      pos.needsUpdate = true;
      if (t > 3) { n.ripple = null; pos.array.set(base); pos.needsUpdate = true; }
    }
  }

  /* ------------------------------------------------------------ stadium bowl */
  const standMat = new THREE.MeshStandardMaterial({ color: 0x0b1424, roughness: 0.95, metalness: 0.1 });
  const profile = [[0, 0], [0, 1.4], [22, 11.5], [24.5, 11.5], [24.5, 15], [47, 31], [47, 0]];
  const tierY = (u) => (u <= 22 ? lerp(1.4, 11.5, u / 22) : lerp(15, 31, (u - 24.5) / 22.5));
  const shape = new THREE.Shape(profile.map(([u, v]) => new THREE.Vector2(u, v)));
  const sides = [
    // front offset from centre, outward axis, length along side, which axis is "along"
    { name: 'N', front: HW + 10, out: new THREE.Vector3(0, 0, -1), len: 2 * (HL + 12 + 47) },
    { name: 'S', front: HW + 10, out: new THREE.Vector3(0, 0, 1), len: 2 * (HL + 12 + 47) },
    { name: 'W', front: HL + 12, out: new THREE.Vector3(-1, 0, 0), len: 2 * (HW + 10) },
    { name: 'E', front: HL + 12, out: new THREE.Vector3(1, 0, 0), len: 2 * (HW + 10) },
  ];
  const ledStrips = [];
  for (const sd of sides) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: sd.len, bevelEnabled: false });
    geo.translate(0, 0, -sd.len / 2);
    const m = new THREE.Mesh(geo, standMat);
    // shape x -> outward axis, extrude z -> along side
    const along = sd.out.clone().cross(new THREE.Vector3(0, 1, 0)).normalize(); // right-handed: out x up
    const basis = new THREE.Matrix4().makeBasis(sd.out, new THREE.Vector3(0, 1, 0), along);
    m.quaternion.setFromRotationMatrix(basis);
    m.position.copy(sd.out).multiplyScalar(sd.front);
    m.receiveShadow = true;
    scene.add(m);
    // roof canopy + LED fascia
    const roofLen = sd.len;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(32, 0.8, roofLen), new THREE.MeshStandardMaterial({ color: 0x060b14, roughness: 1 }));
    roof.quaternion.copy(m.quaternion);
    roof.position.copy(sd.out).multiplyScalar(sd.front + 30); roof.position.y = 40;
    roof.rotateZ(0.08);
    scene.add(roof);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, roofLen), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.95, 1.4), toneMapped: false }));
    strip.quaternion.copy(m.quaternion);
    strip.position.copy(sd.out).multiplyScalar(sd.front + 14.2); strip.position.y = 39.2;
    scene.add(strip); ledStrips.push(strip);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, roofLen), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.5, 0.9), toneMapped: false }));
    mid.quaternion.copy(m.quaternion);
    mid.position.copy(sd.out).multiplyScalar(sd.front + 23.4); mid.position.y = 12.4;
    scene.add(mid);
    sd.mesh = m; sd.along = along;
  }

  /* ------------------------------------------------------------ crowd */
  const crowd = (() => {
    const pos = [], col = [], seed = [], team = [];
    const r3 = rng(99);
    const homeC = COL.home, awayC = COL.away;
    for (const sd of sides) {
      const step = 0.92;
      for (let u = 0.8; u < 46.5; u += step) {
        if (u > 21.6 && u < 25) continue;
        const v = tierY(u) + 0.55;
        for (let a = -sd.len / 2 + 1; a < sd.len / 2 - 1; a += step) {
          const p = sd.out.clone().multiplyScalar(sd.front + u).addScaledVector(sd.along, a + (r3() - 0.5) * 0.4);
          p.y = v + (r3() - 0.5) * 0.25;
          pos.push(p.x, p.y, p.z);
          // allegiance: home end (W) + most of the sides; away end (E) + a corner block
          let t = 0;
          if (sd.name === 'W') t = 1;
          else if (sd.name === 'E') t = 2;
          else t = p.x > 58 ? 2 : (r3() < 0.72 ? 1 : 0);
          team.push(t);
          const k = r3();
          let c;
          if (k < 0.035) c = new THREE.Color(1.6, 1.6, 1.7);                       // phone lights
          else if (t === 1 && k < 0.55) c = homeC.clone().multiplyScalar(lerp(0.35, 0.9, r3()));
          else if (t === 2 && k < 0.6) c = awayC.clone().multiplyScalar(lerp(0.35, 0.9, r3()));
          else { const gr = lerp(0.06, 0.2, r3()); c = new THREE.Color(gr, gr * 1.08, gr * 1.3); }
          col.push(c.r, c.g, c.b);
          seed.push(r3());
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('team', new THREE.Float32BufferAttribute(team, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCheerH: { value: 0 }, uCheerA: { value: 0 }, uFlash: { value: 0 }, uPR: { value: PR }, uWave: { value: -10 } },
      vertexShader: `
        attribute float seed; attribute float team; attribute vec3 color;
        uniform float uTime, uCheerH, uCheerA, uFlash, uPR, uWave;
        varying vec3 vC; varying float vA;
        void main(){
          vec3 p = position;
          float cheer = team == 1.0 ? uCheerH : (team == 2.0 ? uCheerA : max(uCheerH, uCheerA) * 0.35);
          float jump = abs(sin(uTime * (7.0 + seed * 3.0) + seed * 40.0));
          p.y += cheer * jump * 0.55;
          float ang = atan(p.z, p.x);
          float wave = exp(-pow(mod(ang - uWave + 3.14159, 6.28318) - 3.14159, 2.0) * 18.0);
          p.y += wave * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + cheer * 0.6 + wave * 0.8) * 0.62 * uPR * (300.0 / -mv.z);
          float tw = 0.7 + 0.3 * sin(uTime * (0.6 + seed * 1.8) + seed * 30.0);
          vC = color * (tw + cheer * 1.6 * jump + wave * 1.4) + vec3(uFlash) * 0.5 * seed;
          vA = 1.0;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){
          vec2 d = gl_PointCoord - 0.5; float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(vC * smoothstep(0.25, 0.0, r), 1.0);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { mat, count: pos.length / 3 };
  })();

  /* ------------------------------------------------------------ LED boards */
  const led = (() => {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 64;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
    const mats = [];
    const boards = [
      { len: 100, pos: [0, 0.5, -(HW + 5)], ry: 0 },
      { len: 100, pos: [0, 0.5, HW + 5], ry: Math.PI },
      { len: 56, pos: [-(HL + 5), 0.5, 0], ry: Math.PI / 2 },
      { len: 56, pos: [HL + 5, 0.5, 0], ry: -Math.PI / 2 },
    ];
    for (const b of boards) {
      const t = tex.clone(); t.repeat.x = b.len / 34; t.needsUpdate = true;
      const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) });
      mats.push(m);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.len, 1.0), m);
      mesh.position.set(...b.pos); mesh.rotation.y = b.ry; scene.add(mesh);
      const backing = new THREE.Mesh(new THREE.BoxGeometry(b.len, 1.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x05080f }));
      backing.position.set(...b.pos); backing.rotation.y = b.ry; backing.translateZ(-0.2); scene.add(backing);
    }
    let mode = '';
    function draw(next, team) {
      if (next === mode && next !== 'goal') return; mode = next;
      g.clearRect(0, 0, 2048, 64);
      const font = '800 44px "Barlow Condensed", "Arial Narrow", Impact, sans-serif';
      g.font = font; g.textBaseline = 'middle';
      if (next === 'goal') {
        const tc = team === 'away' ? '#ffa62b' : '#38d9f0';
        g.fillStyle = '#0a0f04'; g.fillRect(0, 0, 2048, 64);
        for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#d4ff3f' : tc; g.fillText('GOAL', 20 + i * 256, 34); g.fillStyle = '#ffffff'; g.fillText('●', 170 + i * 256, 34); }
      } else if (next === 'var') {
        g.fillStyle = '#16050a'; g.fillRect(0, 0, 2048, 64);
        for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff4d6d'; g.fillText('VAR CHECK', 20 + i * 340, 34); }
      } else if (next === 'nogoal') {
        g.fillStyle = '#16050a'; g.fillRect(0, 0, 2048, 64);
        for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff4d6d'; g.fillText('NO GOAL · r2', 20 + i * 340, 34); }
      } else {
        g.fillStyle = '#03060c'; g.fillRect(0, 0, 2048, 64);
        const segs = [['ROAR', '#d4ff3f'], ['SOUND OFF · STILL FELT', '#e8f0ff'], ['NORTHBRIDGE', '#38d9f0'], ['VERIFIED BEFORE AIR', '#d4ff3f'], ['RIVERSIDE', '#ffa62b']];
        let x = 16;
        for (const [txt, col] of segs) { g.fillStyle = col; g.fillText(txt, x, 34); x += g.measureText(txt).width + 54; }
      }
      for (const m of mats) { m.map.image = c; m.map.needsUpdate = true; }
    }
    return { draw, mats };
  })();

  /* ------------------------------------------------------------ floodlights */
  const beamMat = (strength) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uS: { value: strength }, uH: { value: 1 } },
    vertexShader: `uniform float uH; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = -position.y / uH; vec4 wp = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uS; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.6); float a = uS * pow(1.0 - vY, 1.6) * edge; gl_FragColor = vec4(vec3(0.82,0.9,1.0) * a, a); }`,
  });
  const towers = [];
  for (const [tx, tz] of [[-80, -58], [80, -58], [-80, 58], [80, 58]]) {
    const base = new THREE.Vector3(tx, 0, tz);
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.3, 58, 8), new THREE.MeshStandardMaterial({ color: 0x0c1322, roughness: 0.8 }));
    pylon.position.set(tx, 29, tz); scene.add(pylon);
    const head = new THREE.Vector3(tx * 0.97, 60, tz * 0.97);
    const lampC = document.createElement('canvas'); lampC.width = 256; lampC.height = 160;
    const lg = lampC.getContext('2d'); lg.fillStyle = '#0a0f18'; lg.fillRect(0, 0, 256, 160);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
      const rg = lg.createRadialGradient(18 + i * 31, 22 + j * 38, 1, 18 + i * 31, 22 + j * 38, 14);
      rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#e6f0ff'); rg.addColorStop(1, '#0a0f18');
      lg.fillStyle = rg; lg.beginPath(); lg.arc(18 + i * 31, 22 + j * 38, 14, 0, 7); lg.fill();
    }
    const lampTex = new THREE.CanvasTexture(lampC); lampTex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 7.5), new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false, color: new THREE.Color(3, 3, 3), side: THREE.DoubleSide }));
    panel.position.copy(head); panel.lookAt(0, 0, 0); scene.add(panel);
    const target = new THREE.Vector3(tx * 0.25, 0, tz * 0.2);
    const dir = target.clone().sub(head); const h = dir.length(); dir.normalize();
    const cg = new THREE.ConeGeometry(30, h, 40, 1, true); cg.translate(0, -h / 2, 0);
    const bm = beamMat(0.075); bm.uniforms.uH.value = h;
    const beam = new THREE.Mesh(cg, bm);
    beam.position.copy(head); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    scene.add(beam);
    const spot = new THREE.SpotLight(0xeef4ff, 210, 0, 0.55, 0.7, 1.2);
    spot.position.copy(head); spot.target.position.copy(target); scene.add(spot); scene.add(spot.target);
    towers.push({ beam, bm, panel });
  }

  /* dust motes in the light */
  const dust = (() => {
    const n = 1400, p = new Float32Array(n * 3), r4 = rng(5);
    for (let i = 0; i < n; i++) p.set([(r4() - 0.5) * 150, 2 + r4() * 50, (r4() - 0.5) * 110], i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, color: 0xcfe0ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(pts); return pts;
  })();

  /* ------------------------------------------------------------ players */
  const torsoG = new THREE.CapsuleGeometry(0.24, 0.5, 6, 14);
  const shortsG = new THREE.CylinderGeometry(0.25, 0.28, 0.32, 14);
  const legG = new THREE.CapsuleGeometry(0.09, 0.62, 4, 8); legG.translate(0, -0.4, 0);
  const armG = new THREE.CapsuleGeometry(0.07, 0.5, 4, 8); armG.translate(0, -0.3, 0);
  const headG = new THREE.SphereGeometry(0.17, 18, 12);
  const haloG = new THREE.RingGeometry(0.62, 0.82, 48);
  const skin = new THREE.MeshStandardMaterial({ color: 0x3a2c25, roughness: 0.7 });
  const figures = [];
  const teamOf = (pl) => (pl.team === D.meta.home ? 'home' : 'away');
  for (const pl of D.players) {
    const team = teamOf(pl), gk = pl.position === 'GK';
    const c = gk ? new THREE.Color(team === 'home' ? '#a98bff' : '#ff6fae') : COL[team].clone();
    const kit = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.05, emissive: c, emissiveIntensity: 0.18 });
    const dark = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.28), roughness: 0.6 });
    const grp = new THREE.Group();
    const torso = new THREE.Mesh(torsoG, kit); torso.position.y = 1.22; torso.castShadow = true; grp.add(torso);
    const shorts = new THREE.Mesh(shortsG, dark); shorts.position.y = 0.84; shorts.castShadow = true; grp.add(shorts);
    const legs = [-1, 1].map((sd) => { const l = new THREE.Mesh(legG, sd < 0 ? kit : kit); l.position.set(sd * 0.12, 0.78, 0); l.castShadow = true; grp.add(l); return l; });
    const arms = [-1, 1].map((sd) => { const a = new THREE.Mesh(armG, kit); a.position.set(sd * 0.3, 1.48, 0); a.rotation.z = sd * 0.12; a.castShadow = true; grp.add(a); return a; });
    const hd = new THREE.Mesh(headG, skin); hd.position.y = 1.74; hd.castShadow = true; grp.add(hd);
    const halo = new THREE.Mesh(haloG, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.4), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03; grp.add(halo);
    grp.scale.setScalar(FIG_SCALE);
    const bx = team === 'home' ? pl.base_x : 100 - pl.base_x;
    const by = team === 'home' ? pl.base_y : 100 - pl.base_y;
    const home = w2(bx, by);
    grp.position.copy(home);
    scene.add(grp);
    figures.push({ pl, team, gk, grp, legs, arms, halo, home, pos: home.clone(), target: home.clone(), override: null, phase: R() * 6, dive: 0, diveTarget: 0, stride: 0 });
  }
  const focus = { x: 0, z: 0, team: 'home' };

  function findFigure(name, team) {
    return figures.find((f) => f.pl.name === name && f.team === team) || figures.find((f) => f.team === team && !f.gk);
  }
  function keeperOf(team) { return figures.find((f) => f.team === team && f.gk); }

  function updatePlayers(dt, t) {
    const pullX = focus.x * 0.32, pullZ = focus.z * 0.2;
    for (const f of figures) {
      if (f.override) f.target.copy(f.override);
      else {
        const toward = f.gk ? 0.04 : (f.team === focus.team ? 0.17 : 0.12);
        const gkClamp = f.gk ? 0 : 1;
        f.target.set(
          clamp(f.home.x + pullX * gkClamp + (focus.x - f.home.x) * toward, -HL + 1, HL - 1),
          0,
          clamp(f.home.z + pullZ * gkClamp + (focus.z - f.home.z) * toward, -HW + 1, HW - 1));
      }
      const k = reduced ? 1 : 1 - Math.exp(-dt * (f.override ? 5.5 : 1.6));
      const before = f.pos.clone();
      f.pos.lerp(f.target, k);
      const speed = before.distanceTo(f.pos) / Math.max(dt, 1e-3);
      f.grp.position.copy(f.pos);
      f.stride = lerp(f.stride, reduced ? 0 : Math.min(speed * 0.09, 0.85), 1 - Math.exp(-dt * 8));
      const sw = Math.sin(t * 11 + f.phase) * f.stride;
      f.legs[0].rotation.x = sw; f.legs[1].rotation.x = -sw;
      f.arms[0].rotation.x = -sw * 0.8; f.arms[1].rotation.x = sw * 0.8;
      f.grp.position.y = Math.abs(Math.sin(t * 11 + f.phase)) * f.stride * 0.12;
      // face movement / the ball
      const look = speed > 0.4 ? f.target : new THREE.Vector3(ball.pos.x, 0, ball.pos.z);
      const ang = Math.atan2(look.x - f.pos.x, look.z - f.pos.z);
      f.grp.rotation.y = ang;
      f.dive = lerp(f.dive, f.diveTarget, reduced ? 1 : 1 - Math.exp(-dt * 10));
      f.grp.rotation.z = 0;
      if (f.dive) { f.grp.rotation.set(0, 0, 0); f.grp.rotation.x = f.dive; f.grp.position.y += Math.abs(f.dive) * 0.5; }
    }
  }

  /* ------------------------------------------------------------ ball + trail */
  const ballTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = '#f4f7ff'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1b2233';
    for (let i = 0; i < 9; i++) { const x = (i * 57) % 256, y = 20 + ((i * 41) % 90); g.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13); } g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ball = {
    mesh: new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 18), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.28 })),
    pos: new THREE.Vector3(0, 0.34, 0), spin: 0, moving: false,
  };
  ball.mesh.castShadow = true; scene.add(ball.mesh);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; scene.add(blob);
  const TRAIL = 48;
  const trail = (() => {
    const p = new Float32Array(TRAIL * 3), a = new Float32Array(TRAIL);
    for (let i = 0; i < TRAIL; i++) a[i] = 1 - i / TRAIL;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('fade', new THREE.BufferAttribute(a, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(1.6, 1.9, 1.0) }, uPR: { value: PR } },
      vertexShader: `attribute float fade; uniform float uPR; varying float vF; void main(){ vF = fade; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = uPR * (2.0 + fade * 11.0) * (40.0 / -mv.z); }`,
      fragmentShader: `uniform float uAlpha; uniform vec3 uColor; varying float vF; void main(){ vec2 d = gl_PointCoord - .5; float r = dot(d,d); if(r>.25) discard; float a = uAlpha * vF * vF * smoothstep(.25,.0,r); gl_FragColor = vec4(uColor * a, a); }`,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
    return { g, m, p, hist: [] };
  })();
  function setBall(v) { ball.pos.copy(v); }
  function updateBall(dt) {
    ball.mesh.position.copy(ball.pos);
    ball.mesh.rotation.x += ball.spin * dt; ball.mesh.rotation.z += ball.spin * dt * 0.4;
    blob.position.set(ball.pos.x, 0.03, ball.pos.z);
    const h = Math.max(0, ball.pos.y - 0.34);
    blob.scale.setScalar(1 + h * 0.18); blob.material.opacity = 0.45 / (1 + h * 0.35);
    trail.hist.unshift(ball.pos.clone()); if (trail.hist.length > TRAIL) trail.hist.pop();
    for (let i = 0; i < TRAIL; i++) { const q = trail.hist[Math.min(i, trail.hist.length - 1)]; trail.p.set([q.x, q.y, q.z], i * 3); }
    trail.g.attributes.position.needsUpdate = true;
    trail.m.uniforms.uAlpha.value = lerp(trail.m.uniforms.uAlpha.value, ball.moving ? 1 : 0, 1 - Math.exp(-dt * (ball.moving ? 20 : 3)));
  }

  /* ------------------------------------------------------------ FX: actor beam, xG cone, ripples, confetti, VAR */
  const fx = new THREE.Group(); scene.add(fx);
  const actorRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 64), new THREE.MeshBasicMaterial({ color: COL.volt.clone().multiplyScalar(1.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  actorRing.rotation.x = -Math.PI / 2; actorRing.position.y = 0.05; fx.add(actorRing);
  const beamG = new THREE.CylinderGeometry(1.1, 1.1, 18, 32, 1, true); beamG.translate(0, 9, 0);
  const actorBeam = new THREE.Mesh(beamG, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uA: { value: 0 }, uC: { value: COL.volt.clone() } },
    vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y / 18.0; vec4 wp = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: 'uniform float uA; uniform vec3 uC; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(vN,vV)), 2.0); float a = uA * pow(1.0 - vY, 2.2) * e; gl_FragColor = vec4(uC * a * 1.6, a); }',
  }));
  fx.add(actorBeam);
  let actor = null;

  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uA: { value: 0 }, uC: { value: COL.home.clone() }, uT: { value: 0 } },
    vertexShader: 'attribute float along; varying float vA; void main(){ vA = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform float uA; uniform vec3 uC; uniform float uT; varying float vA; void main(){ float stripe = 0.75 + 0.25 * sin(vA * 40.0 - uT * 8.0); float a = uA * (0.25 + 0.75 * vA) * stripe; gl_FragColor = vec4(uC * a, a); }',
  });
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  coneGeo.setAttribute('along', new THREE.BufferAttribute(new Float32Array([0, 1, 1]), 1));
  const cone = new THREE.Mesh(coneGeo, coneMat); cone.frustumCulled = false; fx.add(cone);
  const coneState = { target: 0 };
  function showCone(s, goalX, xg, team) {
    const p = coneGeo.attributes.position.array;
    p.set([s.x, 0.06, s.z, goalX, 0.06, -GOAL_HALF, goalX, 0.06, GOAL_HALF]);
    coneGeo.attributes.position.needsUpdate = true;
    coneMat.uniforms.uC.value.copy(COL[team]).multiplyScalar(1.2);
    coneState.target = 0.18 + Math.min(xg || 0, 0.6) * 1.1;
  }

  const ripples = [];
  const rippleGeo = new THREE.PlaneGeometry(1, 1);
  function spawnRing(at, color, maxR, dur, strength, delay) {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uR: { value: 0 }, uA: { value: 0 }, uC: { value: color.clone() }, uW: { value: 0.06 } },
      vertexShader: 'varying vec2 vU; void main(){ vU = uv - .5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform float uR, uA, uW; uniform vec3 uC; varying vec2 vU; void main(){ float d = length(vU) * 2.0; float ring = exp(-pow((d - uR) / uW, 2.0)); float inner = smoothstep(uR, 0.0, d) * 0.04; float a = uA * (ring + inner) * step(d, 1.0); gl_FragColor = vec4(uC * a * 1.3, a); }',
    });
    const mesh = new THREE.Mesh(rippleGeo, m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(at.x, 0.07 + ripples.length * 0.001, at.z);
    mesh.scale.setScalar(maxR * 2); mesh.visible = false; fx.add(mesh);
    ripples.push({ mesh, m, t: -delay, dur, strength });
  }
  const PATTERN_RINGS = {
    tap: [0], double: [0, 0.2], pulse: [0, 0.38, 0.76], wave: [0, 0.14, 0.28, 0.42], surge: [0, 0.14, 0.3, 0.5],
  };
  function ripple(at, pattern = 'tap', intensity = 0.5, color = COL.volt) {
    const offs = PATTERN_RINGS[pattern] || [0];
    const maxR = 6 + intensity * 22;
    offs.forEach((o, i) => spawnRing(at, color, maxR * (1 - i * 0.06), reduced ? 0.01 : 1.5 + intensity * 0.8, 0.25 + intensity * 0.45, o));
  }
  function updateRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.t += dt;
      if (r.t < 0) continue;
      r.mesh.visible = true;
      const k = r.t / r.dur;
      r.m.uniforms.uR.value = easeOut(Math.min(k, 1));
      r.m.uniforms.uA.value = r.strength * (1 - k) * (1 - k);
      r.m.uniforms.uW.value = 0.03 + 0.05 * k;
      if (k >= 1) { fx.remove(r.mesh); r.m.dispose(); ripples.splice(i, 1); }
    }
  }

  // shot map — persistent glowing pucks sized by xG
  const shotMap = new THREE.Group(); scene.add(shotMap);
  const puckG = new THREE.CircleGeometry(1, 40);
  const ringG = new THREE.RingGeometry(0.86, 1, 48);
  function addShot(m, pos) {
    const goal = m.outcome === 'GOAL' || m.overturned;
    const c = (m.overturned ? COL.danger : goal ? COL.volt : COL[m.team]).clone().multiplyScalar(goal ? 1.5 : 0.8);
    const g = new THREE.Group();
    const r = 0.5 + (m.xg || 0.05) * 3.2;
    const disc = new THREE.Mesh(puckG, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: goal ? 0.16 : 0.08, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: goal ? 0.75 : 0.42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    for (const x of [disc, ring]) { x.rotation.x = -Math.PI / 2; x.scale.setScalar(r); g.add(x); }
    g.position.set(pos.x, 0.045, pos.z);
    shotMap.add(g);
  }
  function clearShots() { while (shotMap.children.length) { const g = shotMap.children.pop(); g.children.forEach((c) => c.material.dispose()); } }

  // confetti burst
  const CONF = 900;
  const confetti = (() => {
    const p = new Float32Array(CONF * 3), c = new Float32Array(CONF * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const dotT = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, '#fff'); r.addColorStop(0.45, 'rgba(255,255,255,.85)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
    const m = new THREE.PointsMaterial({ size: 0.16, map: dotT, alphaTest: 0.01, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
    const v = new Float32Array(CONF * 3);
    return { g, m, p, c, v, t: 99 };
  })();
  function burst(at, team) {
    if (reduced) return;
    const r5 = rng((Date.now() & 0xffff) + 3);
    const palette = [COL[team], COL.volt, COL.white];
    for (let i = 0; i < CONF; i++) {
      confetti.p.set([at.x + (r5() - 0.5) * 6, 1 + r5() * 2, at.z + (r5() - 0.5) * 6], i * 3);
      const a = r5() * Math.PI * 2, sp = 6 + r5() * 16;
      confetti.v.set([Math.cos(a) * sp * 0.6, 10 + r5() * 18, Math.sin(a) * sp * 0.6], i * 3);
      const col = palette[i % 3].clone().multiplyScalar(1.4);
      confetti.c.set([col.r, col.g, col.b], i * 3);
    }
    confetti.g.attributes.color.needsUpdate = true;
    confetti.t = 0;
  }
  function updateConfetti(dt) {
    if (confetti.t > 4) { confetti.m.opacity = 0; return; }
    confetti.t += dt;
    for (let i = 0; i < CONF; i++) {
      confetti.v[i * 3 + 1] -= 14 * dt;
      confetti.v[i * 3] *= 0.985; confetti.v[i * 3 + 2] *= 0.985;
      confetti.p[i * 3] += confetti.v[i * 3] * dt;
      confetti.p[i * 3 + 1] = Math.max(0.05, confetti.p[i * 3 + 1] + confetti.v[i * 3 + 1] * dt);
      confetti.p[i * 3 + 2] += confetti.v[i * 3 + 2] * dt;
    }
    confetti.g.attributes.position.needsUpdate = true;
    confetti.m.opacity = Math.max(0, 1 - confetti.t / 4);
  }

  // VAR review: tactical grid over the pitch + a sweeping laser line
  const varGrid = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform float uA, uT; varying vec2 vU;
      void main(){
        vec2 g = abs(fract(vU * vec2(52.5, 34.0)) - .5);
        float line = smoothstep(.47, .5, max(g.x, g.y));
        float scan = exp(-pow((fract(vU.y * 1.0 - uT * .35) - .5) * 12.0, 2.0));
        vec3 c = vec3(1.0, .3, .42) * (line * .5 + scan * .25);
        gl_FragColor = vec4(c * uA, uA * (line * .5 + scan * .25));
      }`,
  }));
  varGrid.rotation.x = -Math.PI / 2; varGrid.position.y = 0.08; fx.add(varGrid);
  const laser = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, W + 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.9), toneMapped: false, transparent: true, opacity: 0 }));
  laser.position.y = 0.1; fx.add(laser);
  const laserWall = new THREE.Mesh(new THREE.PlaneGeometry(W + 4, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.25, 0.4), transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  laserWall.rotation.y = Math.PI / 2; laserWall.position.y = 3; fx.add(laserWall);
  const varState = { a: 0, target: 0, laserX: 0, laserTarget: 0 };

  /* ------------------------------------------------------------ labels (HTML, projected) */
  const tags = {};
  function tag(id, html, cls) {
    let el = tags[id];
    if (!el) { el = document.createElement('div'); el.className = 'tag3d ' + (cls || ''); labels.appendChild(el); tags[id] = el; el._p = new THREE.Vector3(); el._follow = null; }
    el.innerHTML = html; el.className = 'tag3d on ' + (cls || '');
    return el;
  }
  function hideTag(id) { if (tags[id]) tags[id].classList.remove('on'); }
  function hideTags() { for (const k in tags) tags[k].classList.remove('on'); }
  const tmp = new THREE.Vector3();
  function updateTags() {
    const r = canvas.getBoundingClientRect();
    for (const k in tags) {
      const el = tags[k];
      if (!el.classList.contains('on')) continue;
      if (el._follow) el._p.copy(el._follow());
      tmp.copy(el._p).project(camera);
      if (tmp.z > 1) { el.style.opacity = 0; continue; }
      el.style.opacity = '';
      el.style.transform = `translate(${((tmp.x * 0.5 + 0.5) * r.width).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * r.height).toFixed(1)}px)`;
    }
  }

  /* ------------------------------------------------------------ post-processing */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uImpact: { value: 0 }, uDesat: { value: 0 }, uVig: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uImpact, uDesat, uVig; varying vec2 vUv;
      void main(){
        vec2 c = vUv - .5; float d = length(c);
        float ca = .0012 + uImpact * .0055;
        vec3 col = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);
        float l = dot(col, vec3(.299, .587, .114));
        col = mix(col, vec3(l) * vec3(1.08, .9, .95), uDesat * .8);
        col += uDesat * vec3(.05, 0., .012) * (.5 + .5 * sin(vUv.y * 800. + uTime * 18.));
        col *= 1. - smoothstep(.38, .98, d) * .55 * uVig;
        float n = fract(sin(dot(vUv * vec2(1234.5, 4321.7) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        col += (n - .5) * .03;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  composer.addPass(grade);
  const post = { impact: 0, desat: 0, desatTarget: 0, bloomBase: 0.62, bloomKick: 0 };

  /* ------------------------------------------------------------ camera director */
  const cam = {
    pos: camera.position.clone(), look: new THREE.Vector3(0, 4, 0),
    dPos: new THREE.Vector3(0, 48, 96), dLook: new THREE.Vector3(0, 0, 4),
    k: 1.6, mode: 'orbit', orbitA: 0.6, fov: 44, dFov: 44, shake: 0, followBall: 0,
  };
  function shot(pos, look, k = 2.2, fov = 34) {
    cam.mode = 'shot'; cam.dPos.copy(pos); cam.dLook.copy(look); cam.k = k; cam.dFov = fov;
    if (reduced) { cam.pos.copy(pos); cam.look.copy(look); cam.fov = fov; }
  }
  function cut(pos, look, fov = 34) { cam.pos.copy(pos); cam.look.copy(look); shot(pos, look, 2.0, fov); cam.fov = fov; }
  function broadcast() { shot(new THREE.Vector3(0, 50, 98), new THREE.Vector3(0, 0, 6), 1.4, 34); }
  function orbit() { cam.mode = 'orbit'; cam.k = 0.9; cam.dFov = 44; }
  function updateCamera(dt, t) {
    if (cam.mode === 'orbit') {
      cam.orbitA += dt * (reduced ? 0 : 0.05);
      cam.dPos.set(Math.sin(cam.orbitA) * 74, 26 + Math.sin(t * 0.13) * 4, Math.cos(cam.orbitA) * 60);
      cam.dLook.set(0, 4, 0);
    }
    if (cam.followBall > 0) cam.dLook.lerp(ball.pos, cam.followBall);
    const k = reduced ? 1 : 1 - Math.exp(-dt * cam.k);
    cam.pos.lerp(cam.dPos, k); cam.look.lerp(cam.dLook, reduced ? 1 : 1 - Math.exp(-dt * cam.k * 1.6));
    cam.fov = lerp(cam.fov, cam.dFov, reduced ? 1 : 1 - Math.exp(-dt * 3));
    camera.position.copy(cam.pos);
    if (cam.shake > 0.001 && !reduced) {
      camera.position.x += (Math.random() - 0.5) * cam.shake;
      camera.position.y += (Math.random() - 0.5) * cam.shake;
      cam.shake *= Math.exp(-dt * 5);
    }
    camera.lookAt(cam.look);
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }

  /* ------------------------------------------------------------ choreography */
  let seq = 0;
  let paused = false;
  const timers = new Set();
  const wait = (ms) => new Promise((res) => { const id = setTimeout(() => { timers.delete(id); res(); }, reduced ? Math.min(ms, 120) : ms); timers.add(id); });
  function tween(dur, fn) {
    return new Promise((res) => {
      if (reduced || dur <= 0) { fn(1); return res(); }
      const t0 = performance.now();
      const step = (now) => { const k = Math.min(1, (now - t0) / dur); fn(k); if (k < 1) requestAnimationFrame(step); else res(); };
      requestAnimationFrame(step);
    });
  }
  async function flight(p0, p1, apex, dur, alive) {
    ball.moving = true; ball.spin = 18;
    await tween(dur, (k) => {
      if (!alive()) return;
      const e = k;
      ball.pos.set(lerp(p0.x, p1.x, e), lerp(p0.y, p1.y, e) + 4 * apex * e * (1 - e), lerp(p0.z, p1.z, e));
    });
    if (alive()) { ball.moving = false; ball.spin = 3; }
  }

  function resetFX() {
    for (const f of figures) { f.override = null; f.diveTarget = 0; }
    coneState.target = 0; actor = null;
    varState.target = 0; post.desatTarget = 0;
    hideTags();
    led.draw('idle');
  }

  /**
   * Play one engine moment. hooks.onImpact(kind) fires at the instant the
   * outcome becomes visible (net bulges, keeper parries, block, miss).
   */
  async function playMoment(m, hooks = {}) {
    const my = ++seq; const alive = () => my === seq;
    if (intro) { intro = null; introDone && introDone(); } // a moment overrides the fly-in camera
    resetFX();
    const isShot = m.kind === 'shot';
    const sign = m.team === 'home' ? 1 : -1;
    const goalX = sign * HL;
    const s = w2(m.x, m.y);
    const e = isShot ? w2(m.end_x ?? (m.team === 'home' ? 100 : 0), m.end_y ?? 50) : s.clone();
    const dir = isShot ? new THREE.Vector3(goalX - s.x, 0, e.z - s.z).normalize() : new THREE.Vector3(sign, 0, 0);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    focus.x = s.x; focus.z = s.z; focus.team = m.team;

    actor = findFigure(m.player, m.team);
    const spot = s.clone().addScaledVector(dir, -1.1);
    if (actor) {
      actor.pos.copy(s).addScaledVector(dir, -5).addScaledVector(side, 1.5);
      actor.override = spot;
    }
    setBall(new THREE.Vector3(s.x, 0.34, s.z)); ball.moving = false;
    trail.hist.length = 0;

    // camera: broadcast-high, side-on to the action, framing ball + goal
    const mid = isShot ? s.clone().lerp(new THREE.Vector3(goalX, 0, 0), 0.45) : s.clone();
    const camSide = s.z > 0 ? 1 : 1; // always from the main stand side
    const dist = isShot ? clamp(Math.abs(goalX - s.x) * 0.9 + 22, 24, 46) : 30;
    const camPos = new THREE.Vector3(mid.x - sign * dist * 0.35, dist * 0.42, mid.z + camSide * dist);
    if (hooks.cut === false) shot(camPos, mid, 2.4, 30); else cut(camPos.clone().add(new THREE.Vector3(-sign * 8, 6, 10)), mid.clone(), 32);
    shot(camPos, mid, 2.2, 30);

    // actor highlight + name tag + xG cone
    const t1 = tag('actor', `<b>${m.player}</b><i>${m.team === 'home' ? D.meta.home : D.meta.away}</i>`, 'actor ' + m.team);
    t1._follow = () => (actor ? actor.grp.position.clone().add(new THREE.Vector3(0, 3.9, 0)) : s);
    if (isShot) {
      showCone(s, goalX, m.xg, m.team);
      const pct = Math.round((m.xg || 0) * 100);
      const t2 = tag('xg', `<span>xG</span><b>${(m.xg || 0).toFixed(2)}</b><em>${pct}% chance</em>`, 'xg ' + m.team);
      t2._follow = null; t2._p.copy(s.clone().lerp(new THREE.Vector3(goalX, 0, 0), 0.5)).setY(0.5);
    }
    hooks.onStart && hooks.onStart();
    await wait(1150); if (!alive()) return;

    if (!isShot) {
      await flight(ball.pos.clone(), s.clone().addScaledVector(dir, 7).setY(0.34), 0.4, 520, alive); if (!alive()) return;
      hooks.onImpact && hooks.onImpact('event');
      ripple(s, 'tap', 0.4, COL[m.team]);
      await wait(900);
      return;
    }

    hideTag('xg');
    const r6 = rng(m.event_id * 13 + 1);
    const outcome = m.overturned ? 'goal' : ({ 'GOAL': 'goal', 'SAVED BY KEEPER': 'saved', 'BLOCKED': 'blocked' }[m.outcome] || 'wide');
    const d0 = ball.pos.clone();
    const flat = Math.hypot(goalX - s.x, e.z - s.z);
    const dur = clamp(flat / 26, 0.5, 1.15) * 1000;
    cam.followBall = 0.035;
    if (actor) actor.override = s.clone().addScaledVector(dir, 1.5);

    if (outcome === 'goal') {
      const ez = clamp(e.z, -GOAL_HALF + 0.5, GOAL_HALF - 0.5), hy = 0.5 + r6() * 1.5;
      const line = new THREE.Vector3(goalX, hy, ez);
      const keeper = keeperOf(m.team === 'home' ? 'away' : 'home');
      const fl = flight(d0, line, flat * 0.03, dur, alive);
      await wait(dur * 0.6); if (!alive()) return;
      // keeper commits the wrong way — and clears the reverse-angle camera
      const away = ez >= 0 ? -1 : 1;
      if (keeper) { keeper.override = new THREE.Vector3(goalX - sign * 1.2, 0, away * 3.2); keeper.diveTarget = away * 1.2; }
      await fl; if (!alive()) return;
      rippleNet(sign, ez, hy);
      hooks.onImpact && hooks.onImpact('goal');
      cam.followBall = 0;
      cam.shake = 1.4; post.impact = 1; post.bloomKick = 0.55;
      burst(new THREE.Vector3(goalX - sign * 3, 0, ez), m.team);
      crowd.mat.uniforms[m.team === 'home' ? 'uCheerH' : 'uCheerA'].value = 1;
      crowd.mat.uniforms.uWave.value = Math.atan2(0, goalX); waveRun = 1;
      led.draw('goal', m.team);
      ripple(line.clone().setY(0), 'surge', 1, COL.volt);
      flight(line, new THREE.Vector3(goalX + sign * 1.8, 0.4, ez), 0.2, 220, alive);
      // reverse angle from behind the goal, then a slow push
      cut(new THREE.Vector3(goalX + sign * 8.5, 3.6, ez + 5.5), new THREE.Vector3(goalX - sign * 10, 1.2, ez * 0.3), 44);
      shot(new THREE.Vector3(goalX + sign * 6.5, 2.8, ez + 3.5), new THREE.Vector3(goalX - sign * 12, 1.3, ez * 0.25), 0.55, 40);
      if (actor) actor.override = new THREE.Vector3(goalX - sign * 12, 0, clamp(ez + 10 * (s.z > 0 ? 1 : -1), -HW + 2, HW - 2));
      await wait(1900); if (!alive()) return;
    } else if (outcome === 'saved') {
      const keeper = keeperOf(m.team === 'home' ? 'away' : 'home');
      const ez = clamp(e.z, -GOAL_HALF + 0.3, GOAL_HALF - 0.3), hy = 0.6 + r6() * 1.2;
      const at = new THREE.Vector3(goalX - sign * 0.7, hy, ez);
      if (keeper) { keeper.override = new THREE.Vector3(goalX - sign * 0.9, 0, ez * 0.6); }
      const fl = flight(d0, at, flat * 0.025, dur, alive);
      await wait(dur * 0.55); if (!alive()) return;
      if (keeper && Math.abs(ez) > 0.6) { keeper.override = new THREE.Vector3(goalX - sign * 0.9, 0, ez * 0.9); keeper.diveTarget = Math.sign(ez) * 1.15; }
      await fl; if (!alive()) return;
      hooks.onImpact && hooks.onImpact('saved');
      cam.followBall = 0; cam.shake = 0.5; post.impact = 0.45;
      ripple(at.clone().setY(0), 'pulse', 0.7, COL.home);
      await flight(at, new THREE.Vector3(goalX - sign * 5, 0.34, ez + Math.sign(ez || 1) * 9), 2.5, 650, alive); if (!alive()) return;
      await wait(1000);
    } else if (outcome === 'blocked') {
      const at = d0.clone().lerp(new THREE.Vector3(goalX, 0.6, e.z), 0.22); at.y = 0.7;
      const others = figures.filter((f) => f.team !== m.team && !f.gk);
      const blocker = others.reduce((a, f) => (f.pos.distanceTo(at) < a.pos.distanceTo(at) ? f : a), others[0]);
      if (blocker) blocker.override = at.clone().setY(0).addScaledVector(dir, 0.4);
      await flight(d0, at, 0.2, dur * 0.4, alive); if (!alive()) return;
      hooks.onImpact && hooks.onImpact('blocked');
      cam.followBall = 0; cam.shake = 0.6; post.impact = 0.4;
      ripple(at.clone().setY(0), 'double', 0.6, COL.danger);
      await flight(at, at.clone().addScaledVector(side, (r6() > 0.5 ? 1 : -1) * 10).addScaledVector(dir, -3).setY(0.34), 1.6, 600, alive); if (!alive()) return;
      await wait(1000);
    } else {
      const inside = Math.abs(e.z) <= GOAL_HALF + 0.2;
      const at = inside ? new THREE.Vector3(goalX, GOAL_H + 0.9 + r6() * 0.8, e.z) : new THREE.Vector3(goalX, 0.8 + r6() * 1.2, e.z);
      await flight(d0, at, flat * 0.035, dur, alive); if (!alive()) return;
      hooks.onImpact && hooks.onImpact('wide');
      cam.followBall = 0;
      ripple(new THREE.Vector3(goalX, 0, e.z), 'tap', 0.35, COL.white);
      await flight(at, new THREE.Vector3(goalX + sign * 7, 0.34, e.z * 1.15), 0.6, 450, alive); if (!alive()) return;
      await wait(1000);
    }
  }

  /** VAR review: desaturate, tactical grid, laser sweep to the scorer's line. */
  async function varReview(m, hooks = {}) {
    const my = seq; const alive = () => my === seq;
    const sign = m.team === 'home' ? 1 : -1;
    const s = w2(m.x, m.y);
    post.desatTarget = 1; varState.target = 1;
    led.draw('var');
    crowd.mat.uniforms.uCheerH.value = 0; crowd.mat.uniforms.uCheerA.value = 0;
    hideTags();
    // the VAR room's view: high, top-down over the attacking third
    cut(new THREE.Vector3(sign * 26, 72, 18), new THREE.Vector3(sign * 30, 0, 0), 40);
    shot(new THREE.Vector3(sign * 30, 62, 14), new THREE.Vector3(sign * 32, 0, 0), 0.8, 40);
    varState.laserX = 0; varState.laserTarget = s.x;
    hooks.onVar && hooks.onVar('check');
    await wait(2100); if (!alive()) return;
    led.draw('nogoal');
    crowd.mat.uniforms[m.team === 'home' ? 'uCheerA' : 'uCheerH'].value = 1;
    hooks.onVar && hooks.onVar('overturned');
    ripple(s, 'double', 0.8, COL.danger);
    await wait(1700); if (!alive()) return;
    post.desatTarget = 0; varState.target = 0;
  }

  /* ------------------------------------------------------------ main loop */
  let last = performance.now(), T = 0, waveRun = 0, intro = null, introDone = null;
  function frame(now) {
    requestAnimationFrame(frame);
    if (paused) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!reduced) T += dt;                       // ambient motion (crowd, boards, dust) freezes under reduced motion
    crowd.mat.uniforms.uTime.value = T;
    crowd.mat.uniforms.uCheerH.value *= Math.exp(-dt * 0.45);
    crowd.mat.uniforms.uCheerA.value *= Math.exp(-dt * 0.45);
    if (waveRun > 0 && !reduced) { crowd.mat.uniforms.uWave.value += dt * 2.4; waveRun -= dt * 0.25; } else crowd.mat.uniforms.uWave.value = -10;
    if (!reduced) for (const m of led.mats) m.map.offset.x = (m.map.offset.x + dt * 0.035) % 1;
    for (const s of ledStrips) s.material.color.setRGB(0.5 + Math.sin(T * 0.7) * 0.1, 0.95, 1.4);
    if (!reduced) dust.rotation.y += dt * 0.004;
    if (intro) intro(dt);
    updatePlayers(dt, T);
    updateBall(dt);
    updateNets(dt);
    updateRipples(dt);
    updateConfetti(dt);
    coneMat.uniforms.uA.value = lerp(coneMat.uniforms.uA.value, coneState.target, 1 - Math.exp(-dt * 6));
    coneMat.uniforms.uT.value = T;
    cone.visible = coneMat.uniforms.uA.value > 0.005;
    if (actor) {
      actorRing.position.set(actor.pos.x, 0.05, actor.pos.z);
      actorRing.material.opacity = lerp(actorRing.material.opacity, 0.9, 0.1);
      actorRing.scale.setScalar(1 + Math.sin(T * 5) * 0.08);
      actorBeam.position.set(actor.pos.x, 0, actor.pos.z);
      actorBeam.material.uniforms.uA.value = lerp(actorBeam.material.uniforms.uA.value, 0.55, 0.08);
      actorBeam.material.uniforms.uC.value.copy(COL.volt);
    } else {
      actorRing.material.opacity *= 0.9; actorBeam.material.uniforms.uA.value *= 0.9;
    }
    varState.a = lerp(varState.a, varState.target, 1 - Math.exp(-dt * 4));
    varGrid.material.uniforms.uA.value = varState.a; varGrid.material.uniforms.uT.value = T;
    varState.laserX = lerp(varState.laserX, varState.laserTarget, 1 - Math.exp(-dt * 1.8));
    laser.position.x = varState.laserX; laserWall.position.x = varState.laserX;
    laser.material.opacity = varState.a; laserWall.material.opacity = varState.a * 0.16;
    laser.visible = laserWall.visible = varGrid.visible = varState.a > 0.01;
    post.desat = lerp(post.desat, post.desatTarget, 1 - Math.exp(-dt * 4));
    post.impact *= Math.exp(-dt * 3.5);
    post.bloomKick *= Math.exp(-dt * 1.6);
    bloom.strength = post.bloomBase + post.bloomKick;
    grade.uniforms.uTime.value = T; grade.uniforms.uImpact.value = reduced ? 0 : post.impact; grade.uniforms.uDesat.value = post.desat;
    for (const tw of towers) tw.bm.uniforms.uS.value = 0.07 + post.bloomKick * 0.04;
    updateCamera(dt, T);
    if (NOPOST) renderer.render(scene, camera); else composer.render(dt);
    updateTags();
  }

  /* ------------------------------------------------------------ intro fly-in */
  function flyIn(ms = 3600) {
    return new Promise((res) => {
      if (reduced) { broadcast(); return res(); }
      cam.mode = 'shot';
      const p0 = cam.pos.clone(), l0 = cam.look.clone();
      const p1 = new THREE.Vector3(0, 50, 98), l1 = new THREE.Vector3(0, 0, 6);
      const t0 = performance.now();
      introDone = res;
      intro = () => {
        const t = (performance.now() - t0) / ms;
        const k = easeInOut(Math.min(t, 1));
        const a = (1 - k) * 1.4;
        const r = lerp(Math.hypot(p0.x, p0.z), Math.hypot(p1.x, p1.z), k);
        cam.dPos.set(Math.sin(a) * r, lerp(p0.y, p1.y, k), Math.cos(a) * r);
        cam.dLook.copy(l0).lerp(l1, k);
        cam.pos.copy(cam.dPos); cam.look.copy(cam.dLook);
        if (t >= 1) { intro = null; introDone = null; broadcast(); res(); }
      };
    });
  }

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(PR);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { paused = document.hidden; });
  if (document.fonts && document.fonts.load) {
    try { await Promise.race([document.fonts.load('800 44px "Barlow Condensed"'), new Promise((r) => setTimeout(r, 1200))]); } catch (e) { /* fall back */ }
  }
  led.draw('idle');
  resize();
  requestAnimationFrame(frame);

  return {
    playMoment, varReview, ripple: (x, y, p, i, team) => ripple(w2(x, y), p, i, team ? COL[team] : COL.volt),
    addShot: (m) => addShot(m, w2(m.x, m.y)), clearShots,
    orbit, broadcast, flyIn,
    cancel() { seq++; resetFX(); cam.followBall = 0; },
    setReduced(v) { reduced = v; },
    crowdCount: crowd.count,
  };
}
