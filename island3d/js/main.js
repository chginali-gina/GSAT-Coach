import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ================= 資料與本機進度 ================= */
const DATA = await fetch('data/islands.json').then(r => r.json());
const ALL = [DATA.center, ...DATA.islands];
const OPEN = DATA.islands.filter(i => i.status === 'open');
const byId = Object.fromEntries(ALL.map(i => [i.id, i]));
const CHARS = DATA.characters;

const KEY = 'gina-archipelago-3d';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 無痕模式可能不能存 */ } },
};
let S = Object.assign({ name: '', char: 'luna', music: true, prog: {} }, store.get());
const save = () => store.set(S);
const P = id => (S.prog[id] = S.prog[id] || { read: false, res: false, quiz: false, done: false });
const doneCount = () => OPEN.filter(i => S.prog[i.id] && S.prog[i.id].done).length;
const myChar = () => CHARS.find(c => c.id === S.char && !c.locked) || CHARS.find(c => !c.locked);

/* ================= 小工具 ================= */
const $ = s => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================= 音樂與音效 ================= */
const audio = new Audio();
audio.loop = true;
audio.preload = 'none';
audio.volume = 0.42;
let currentTrack = '';
function playTrack(src) {
  if (!S.music) return;
  if (currentTrack !== src) { currentTrack = src; audio.src = src; }
  audio.play().catch(() => {});
}
function setMusic(on) {
  S.music = on; save();
  $('#musicBtn').textContent = on ? '♪ 開' : '♪ 關';
  $('#musicBtn').setAttribute('aria-pressed', String(on));
  if (on) playTrack(openId ? byId[openId].music : DATA.center.music); else audio.pause();
}
$('#musicBtn').onclick = () => setMusic(!S.music);

let actx = null;
function sfx(kind) {
  if (!S.music) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    if (kind === 'step') {
      o.type = 'triangle'; o.frequency.setValueAtTime(140 + Math.random() * 30, t);
      g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.start(t); o.stop(t + 0.09);
    } else if (kind === 'portal') {
      o.type = 'sine'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.start(t); o.stop(t + 0.62);
    } else if (kind === 'chime') {
      o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.12);
      g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.52);
    }
  } catch { /* 不支援就安靜 */ }
}

/* ================= 3D 世界 ================= */
const stage = $('#stage');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }

const lowEnd = (navigator.hardwareConcurrency || 4) <= 4;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
const loader = new THREE.TextureLoader();
let controls = null;
const clickable = [];
const isleObj = {};
const WORLD_R = 34;
const ISLE_Y = 2.6;          // 浮島底部離地高度
const PORTAL_R = 1.9;        // 走進這個半徑就登島
const TALK_R = 7.5;          // 島主開口說話的距離

const player = { pos: new THREE.Vector3(0, 0, 6.5), sprite: null, shadow: null, phase: 0, stepAcc: 0, flip: false,
  target: null, targetIsle: null, frozen: true, lockId: null, scale: 1 };
let marker = null;
let openId = null;
let talkingId = null;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pill(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function makeLabel(I) {
  const hold = I.status === 'hold';
  const tex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = 'rgba(14,10,46,0.85)'; g.strokeStyle = I.color; g.lineWidth = 6;
    pill(g, 8, 16, w - 16, h - 32, 46); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = '800 56px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(I.name + (hold ? '（建設中）' : ''), w / 2, h / 2 + 2, w - 60);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(4, 1, 1);
  sp.renderOrder = 6;
  return sp;
}
const radialTex = (inner, outer) => canvasTex(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.5 : 2));
  stage.appendChild(renderer.domElement);

  scene.background = canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#04051a'); grd.addColorStop(0.5, '#1a0f4e'); grd.addColorStop(1, '#3d1c72');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x22125a, 34, 85);
  scene.add(new THREE.HemisphereLight(0xd8deff, 0x3a1a6e, 1.5));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 9;
  controls.maxDistance = 42;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.36;
  controls.addEventListener('start', () => { $('#hint').style.opacity = 0; });

  // 星空
  const sp = [];
  for (let i = 0; i < 1400; i++) {
    const r = 140 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.42;
    sp.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, fog: false, transparent: true, opacity: 0.85 })));

  // 符文石地面（上傳的地面材質），邊緣淡出成雲海
  const gtex = loader.load('img/ground.webp');
  gtex.colorSpace = THREE.SRGBColorSpace;
  gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
  gtex.repeat.set(9, 9);
  gtex.anisotropy = 8;
  const fade = canvasTex(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.36, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#000');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  fade.colorSpace = THREE.NoColorSpace;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(WORLD_R + 6, 72),
    new THREE.MeshLambertMaterial({ map: gtex, alphaMap: fade, transparent: true, color: 0x9da2e0 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // 雲海
  const cloudTex = radialTex('rgba(255,255,255,0.6)', 'rgba(255,255,255,0)');
  for (let i = 0; i < (lowEnd ? 16 : 30); i++) {
    const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: i % 3 ? 0xb9a8ff : 0xff9fe8, transparent: true, opacity: 0.28, depthWrite: false }));
    const a = Math.random() * Math.PI * 2, r = WORLD_R + 2 + Math.random() * 18;
    c.position.set(Math.cos(a) * r, -1 - Math.random() * 3, Math.sin(a) * r);
    const s = 14 + Math.random() * 18;
    c.scale.set(s, s * 0.45, 1);
    scene.add(c);
  }

  // 從廣場通往各島的光之路
  DATA.islands.forEach(I => {
    const len = Math.hypot(I.x, I.z);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(0.5, len - 4),
      new THREE.MeshBasicMaterial({ color: I.color, transparent: true, opacity: 0.22, depthWrite: false }));
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = -Math.atan2(I.x, I.z);
    path.position.set(I.x / 2, 0.02, I.z / 2);
    scene.add(path);
  });

  // 島嶼：浮島立牌＋地上的傳送陣＋光柱
  const stampTex = canvasTex(128, 128, g => {
    const grd = g.createRadialGradient(64, 56, 10, 64, 64, 60);
    grd.addColorStop(0, '#FFF3C4'); grd.addColorStop(1, '#E7A935');
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#7A4A00'; g.stroke();
    g.fillStyle = '#7A4A00'; g.font = '900 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('★', 64, 68);
  });
  const beamTex = canvasTex(4, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  ALL.forEach((I, idx) => {
    const g = new THREE.Group();
    g.position.set(I.x, 0, I.z);
    const size = I.id === 'plaza' ? 9 : 7;
    const hold = I.status === 'hold';

    const ring = new THREE.Mesh(new THREE.RingGeometry(PORTAL_R - 0.25, PORTAL_R, 48),
      new THREE.MeshBasicMaterial({ color: I.color, transparent: true, opacity: hold ? 0.3 : 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(PORTAL_R - 0.25, 48),
      new THREE.MeshBasicMaterial({ color: I.color, transparent: true, opacity: hold ? 0.08 : 0.2, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_R - 0.4, PORTAL_R - 0.2, ISLE_Y + 0.6, 32, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color: I.color, transparent: true, opacity: hold ? 0.12 : 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = (ISLE_Y + 0.6) / 2;
    beam.userData.id = I.id;
    g.add(ring, disc, beam);

    const mat = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.08 });
    if (hold) mat.color.set(0x9a9ac0);
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0.04);
    sprite.position.y = ISLE_Y;
    sprite.visible = false;
    loader.load(I.img, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex; mat.needsUpdate = true;
      sprite.scale.set(size * tex.image.width / tex.image.height, size, 1);
      sprite.visible = true;
    });
    sprite.userData.id = I.id;

    const label = makeLabel(I);
    label.position.y = ISLE_Y - 0.5;
    label.userData.id = I.id;

    const stamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: stampTex, transparent: true, depthWrite: false }));
    stamp.scale.set(1.4, 1.4, 1);
    stamp.position.set(size * 0.38, ISLE_Y + size * 0.85, 0);
    stamp.visible = false;

    g.add(sprite, label, stamp);
    clickable.push(sprite, label, beam);
    scene.add(g);
    isleObj[I.id] = { group: g, sprite, label, stamp, ring, beam, size, phase: idx * 0.8 };
  });

  // 點擊地面時的目標標記
  marker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 32), new THREE.MeshBasicMaterial({ color: 0x3EF0FF, transparent: true, opacity: 0.9, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.05; marker.visible = false;
  scene.add(marker);

  // 玩家角色
  player.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  player.shadow.rotation.x = -Math.PI / 2; player.shadow.scale.set(1, 0.55, 1); player.shadow.position.y = 0.05;
  scene.add(player.shadow);
  player.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.1, depthTest: false }));
  player.sprite.center.set(0.5, 0);
  player.sprite.renderOrder = 10;   // 角色永遠看得到，不會被浮島擋住
  scene.add(player.sprite);
  setPlayerSkin();

  // 鏡頭從角色身後
  camera.position.set(0, 12.5, player.pos.z + 17);
  controls.target.set(player.pos.x, 1.6, player.pos.z);
  controls.update();

  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
} else {
  stage.append(el('p', { style: 'position:absolute;top:40%;width:100%;text-align:center;color:#B9C0F0' }, '這台裝置無法顯示 3D，請用右上角「☰ 島嶼」登島。'));
}

function setPlayerSkin() {
  const c = myChar();
  if (!player.sprite || !c) return;
  loader.load(c.walk, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    player.sprite.material.map = tex;
    player.sprite.material.needsUpdate = true;
    const H = 3.0;
    player.baseScale = [H * tex.image.width / tex.image.height, H];
    player.sprite.scale.set(player.baseScale[0], H, 1);
  });
}

/* ================= 操控：鍵盤、搖桿、點擊 ================= */
const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault(); }
  if (k === 'e' && talkingId && !openId) goInto(talkingId);
  if (k === 'escape') { if (openId) closePanel(); $('#drawer').hidden = true; }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const joy = { x: 0, y: 0, id: null };
const joyEl = $('#joy'), knob = $('#joyKnob');
function joyMove(e) {
  const r = joyEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2 - 10, d = Math.hypot(dx, dy);
  if (d > max) { dx *= max / d; dy *= max / d; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  joy.x = dx / max; joy.y = dy / max;
}
joyEl.addEventListener('pointerdown', e => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyMove(e); });
joyEl.addEventListener('pointermove', e => { if (joy.id === e.pointerId) joyMove(e); });
const joyEnd = () => { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; };
joyEl.addEventListener('pointerup', joyEnd);
joyEl.addEventListener('pointercancel', joyEnd);

if (renderer) {
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt = new THREE.Vector3();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 7 || player.frozen) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(clickable, false)[0];
    if (hit) { goInto(hit.object.userData.id); return; }
    if (ray.ray.intersectPlane(floorPlane, hitPt)) walkTo(hitPt.clone(), null);
  });
}

function walkTo(point, isleId) {
  if (point.length() > WORLD_R) point.setLength(WORLD_R);
  player.target = point; player.targetIsle = isleId;
  if (marker) { marker.position.set(point.x, 0.05, point.z); marker.visible = !isleId; }
}
function goInto(id) {
  const I = byId[id];
  if (!I) return;
  if (!renderer) { openPanel(id); return; }
  player.lockId = null;
  walkTo(new THREE.Vector3(I.x, 0, I.z), id);
}

/* ================= 遊戲迴圈 ================= */
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3(), tmp = new THREE.Vector3();
let entering = null;   // 走進島的動畫

if (renderer) renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  for (const id in isleObj) {
    const o = isleObj[id];
    const bob = Math.sin(t * 0.7 + o.phase) * 0.3;
    o.sprite.position.y = ISLE_Y + bob;
    o.label.position.y = ISLE_Y - 0.5 + bob;
    o.stamp.position.y = ISLE_Y + o.size * 0.85 + bob;
    o.ring.material.opacity = (byId[id].status === 'hold' ? 0.3 : 0.6) + Math.sin(t * 3 + o.phase) * 0.25;
  }
  if (marker && marker.visible) { marker.scale.setScalar(1 + Math.sin(t * 6) * 0.15); }

  // 角色移動
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  right.crossVectors(fwd, camera.up).normalize();
  mv.set(0, 0, 0);
  if (!player.frozen && !entering) {
    let ix = 0, iz = 0;
    if (keys.has('w') || keys.has('arrowup')) iz += 1;
    if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
    if (joy.id !== null) { ix += joy.x; iz -= joy.y; }
    if (ix || iz) {
      mv.addScaledVector(fwd, iz).addScaledVector(right, ix);
      if (mv.length() > 1) mv.normalize();
      player.target = null; player.targetIsle = null; if (marker) marker.visible = false;
      $('#hint').style.opacity = 0;
    } else if (player.target) {
      mv.subVectors(player.target, player.pos); mv.y = 0;
      const d = mv.length();
      if (d < 0.25) { player.target = null; if (marker) marker.visible = false; mv.set(0, 0, 0); }
      else mv.normalize();
    }
  }
  const moving = mv.lengthSq() > 0.0001;
  if (moving) {
    player.pos.addScaledVector(mv, 7.5 * dt);
    if (player.pos.length() > WORLD_R) player.pos.setLength(WORLD_R);
    const sx = mv.dot(right);
    if (Math.abs(sx) > 0.15) player.flip = sx < 0;
    player.phase += dt * 11;
    player.stepAcc += dt;
    if (player.stepAcc > 0.29) { player.stepAcc = 0; sfx('step'); }
  } else {
    player.phase += dt * 2;
  }
  // 角色外觀（走路彈跳、左右翻面、登島縮小）
  if (player.sprite && player.baseScale) {
    const [bw, bh] = player.baseScale;
    const hop = moving ? Math.abs(Math.sin(player.phase)) * 0.22 : Math.sin(player.phase) * 0.04;
    let s = player.scale, lift = 0;
    if (entering) {
      entering.t += dt * 1.6;
      const k = Math.min(1, entering.t);
      s = 1 - k * 0.85; lift = k * (ISLE_Y + 1);
      if (k >= 1 && !entering.done) { entering.done = true; $('#flash').classList.remove('on'); openPanel(entering.id); }
    }
    player.sprite.scale.set((player.flip ? -1 : 1) * bw * s, bh * s, 1);
    player.sprite.material.map && (player.sprite.material.map.repeat.x = 1);
    player.sprite.position.set(player.pos.x, hop + lift, player.pos.z);
    player.sprite.material.rotation = moving ? Math.sin(player.phase) * 0.04 : 0;
    player.sprite.material.opacity = entering ? Math.max(0, 1 - entering.t) : 1;
    player.shadow.position.set(player.pos.x, 0.05, player.pos.z);
    player.shadow.scale.set(s * (1 - hop * 0.6), 0.55 * s * (1 - hop * 0.6), 1);
  }

  // 島主對話與傳送陣
  if (!player.frozen && !entering) {
    let near = null, nd = 1e9;
    for (const I of ALL) {
      const d = Math.hypot(player.pos.x - I.x, player.pos.z - I.z);
      if (d < nd) { nd = d; near = I; }
    }
    if (player.lockId && byId[player.lockId] && Math.hypot(player.pos.x - byId[player.lockId].x, player.pos.z - byId[player.lockId].z) > PORTAL_R + 1.2) player.lockId = null;
    if (near && nd < PORTAL_R && near.id !== player.lockId) startEnter(near.id);
    else if (near && nd < TALK_R && near.id !== player.lockId) showTalk(near.id);
    else if (talkingId && (!near || nd > TALK_R + 1 || near.id !== talkingId)) hideTalk();
  }

  // 鏡頭跟著角色
  tmp.set(player.pos.x, 1.6, player.pos.z).sub(controls.target);
  controls.target.add(tmp);
  camera.position.add(tmp);
  controls.update();

  updateQuest();
  drawMinimap();
  renderer.render(scene, camera);
});

function startEnter(id) {
  hideTalk();
  player.target = null; player.targetIsle = null;
  if (marker) marker.visible = false;
  player.pos.set(byId[id].x, 0, byId[id].z);
  entering = { id, t: 0, done: false };
  sfx('portal');
  $('#flash').classList.add('on');
}

/* 島主開口 */
let typeTimer = null;
function showTalk(id) {
  if (talkingId === id) return;
  talkingId = id;
  const I = byId[id];
  $('#talkName').textContent = `${I.chief.name}・${I.chief.title}`;
  const text = I.status === 'hold' ? I.chief.line : `${I.chief.line}　歡迎來到「${I.name}」，走進傳送陣就能登島。`;
  const box = $('#talkText');
  box.textContent = '';
  let i = 0;
  clearInterval(typeTimer);
  typeTimer = setInterval(() => { box.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typeTimer); }, 28);
  $('#talkGo').textContent = I.status === 'hold' ? '看看施工進度' : (S.prog[id] && S.prog[id].done ? '再進去看看 ★' : '進入島嶼');
  $('#talk').hidden = false;
  sfx('chime');
}
function hideTalk() { talkingId = null; clearInterval(typeTimer); $('#talk').hidden = true; }
$('#talkGo').onclick = () => { if (talkingId) goInto(talkingId); };

/* 任務追蹤 */
function nextQuest() { return OPEN.find(i => !(S.prog[i.id] && S.prog[i.id].done)); }
const projA = new THREE.Vector3(), projB = new THREE.Vector3();
function updateQuest() {
  const q = nextQuest();
  const txt = $('#questText'), arrow = $('#questArrow');
  if (!q) { txt.textContent = '全部島章到手！回星港廣場領證書'; arrow.style.visibility = 'hidden'; return; }
  const d = Math.round(Math.hypot(player.pos.x - q.x, player.pos.z - q.z));
  txt.textContent = `前往「${q.name}」・${d} 公尺`;
  projA.set(player.pos.x, 1, player.pos.z).project(camera);
  projB.set(q.x, 1, q.z).project(camera);
  if (projB.z > 1) projB.multiplyScalar(-1);
  const ang = Math.atan2(-(projB.y - projA.y) / camera.aspect, projB.x - projA.x);
  arrow.style.visibility = 'visible';
  arrow.style.transform = `rotate(${ang}rad)`;
}

/* 小地圖（上方＝鏡頭面向） */
const mm = $('#minimap'), mg = mm.getContext('2d');
function drawMinimap() {
  const W = mm.width, c = W / 2, sc = (W / 2 - 10) / (WORLD_R + 2);
  camera.getWorldDirection(fwd);
  const yaw = Math.atan2(fwd.x, fwd.z);
  mg.clearRect(0, 0, W, W);
  mg.save();
  mg.beginPath(); mg.arc(c, c, c - 2, 0, Math.PI * 2); mg.clip();
  mg.fillStyle = 'rgba(30,20,80,0.6)'; mg.fillRect(0, 0, W, W);
  const toMap = (x, z) => {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const rx = x * cs - z * sn, rz = x * sn + z * cs;
    return [c + rx * sc * -1, c + rz * sc * -1];
  };
  const q = nextQuest();
  for (const I of ALL) {
    const [mx, my] = toMap(I.x, I.z);
    const done = S.prog[I.id] && S.prog[I.id].done;
    mg.fillStyle = I.status === 'hold' ? '#777' : done ? '#FFD27A' : I.color;
    mg.beginPath(); mg.arc(mx, my, I.id === 'plaza' ? 7 : 5, 0, Math.PI * 2); mg.fill();
    if (q && I.id === q.id) {
      mg.strokeStyle = '#FFD27A'; mg.lineWidth = 2;
      mg.beginPath(); mg.arc(mx, my, 9 + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2); mg.stroke();
    }
  }
  const [px, py] = toMap(player.pos.x, player.pos.z);
  mg.fillStyle = '#fff';
  mg.beginPath(); mg.moveTo(px, py - 7); mg.lineTo(px + 5, py + 5); mg.lineTo(px - 5, py + 5); mg.closePath(); mg.fill();
  mg.restore();
  mg.strokeStyle = 'rgba(62,240,255,0.7)'; mg.lineWidth = 2;
  mg.beginPath(); mg.arc(c, c, c - 2, 0, Math.PI * 2); mg.stroke();
}

function refreshStamps() {
  for (const I of OPEN) if (isleObj[I.id]) isleObj[I.id].stamp.visible = !!(S.prog[I.id] && S.prog[I.id].done);
  $('#stamps').textContent = `🏅 ${doneCount()} / ${OPEN.length}`;
}

/* ================= 島內面板 ================= */
function videoEl(v) {
  const box = el('div', { class: 'video' });
  if (v.type === 'youtube') box.append(el('iframe', { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}`, title: 'YouTube 影片', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: '' }));
  else box.append(el('video', { src: v.src, controls: '', playsinline: '', preload: 'metadata' }));
  return box;
}

function openPanel(id) {
  const I = byId[id];
  openId = id;
  player.frozen = true;
  hideTalk();
  document.body.classList.add('panel-open');
  $('#drawer').hidden = true;
  const body = $('#panelBody');
  body.replaceChildren();
  body.style.setProperty('--c', I.color);
  const isCenter = id === 'plaza', hold = I.status === 'hold';
  const p = isCenter || hold ? null : P(id);
  const c = myChar();

  body.append(
    el('div', { class: 'isle-hero' },
      el('img', { class: 'h-isle', src: I.img, alt: '' }),
      c ? el('img', { class: 'h-char', src: c.walk, alt: c.name }) : null),
    el('div', {},
      el('span', { class: 'sea' }, I.seaName),
      el('h2', { style: 'margin:4px 0 0' }, I.name),
      el('div', { class: 'en note' }, I.en)),
    el('div', { class: 'chief-say' },
      el('div', { class: 'who' }, I.chief.name, el('br'), el('small', { class: 'note' }, I.chief.title)),
      el('div', { class: 'bubble' }, I.chief.line)),
  );

  if (isCenter) {
    const who = S.name ? `${S.name}，` : '';
    body.append(el('p', { class: 'goal' }, `${who}你已經收集 ${doneCount()} / ${OPEN.length} 個島章。`));
  } else if (!hold) {
    body.append(el('p', { class: 'goal' }, '🎯 ' + I.goal));
    const steps = el('div', { class: 'steps' });
    I._drawSteps = () => steps.replaceChildren(
      el('span', { class: p.read ? 'on' : '' }, (p.read ? '✓ ' : '① ') + '讀教材'),
      el('span', { class: p.res ? 'on' : '' }, (p.res ? '✓ ' : '② ') + '開一項資源'),
      el('span', { class: p.quiz ? 'on' : '' }, (p.quiz ? '✓ ' : '③ ') + '測驗過關'));
    I._drawSteps();
    body.append(steps);
  }

  body.append(el('h3', {}, isCenter ? '🗺️ 群島導覽' : hold ? '🏗️ 施工中' : '📖 教材'));
  I.sections.forEach(s => body.append(el('div', { class: 'sec' }, el('b', {}, s.title), el('p', {}, s.body))));
  if (p) {
    const readBtn = el('button', { class: 'btn' + (p.read ? ' done' : ''), type: 'button' }, p.read ? '✓ 已讀完' : '我讀完了');
    readBtn.onclick = () => { if (p.read) return; p.read = true; readBtn.textContent = '✓ 已讀完'; readBtn.classList.add('done'); progress(I); };
    body.append(readBtn);
  }

  if (I.video) body.append(el('h3', {}, '🎬 影片'), videoEl(I.video));

  if (I.resources.length) {
    body.append(el('h3', {}, '🧰 教材資源'));
    I.resources.forEach(r => {
      const a = el('a', { class: 'res', href: r.url, target: '_blank', rel: 'noopener' },
        el('span', { class: 'tag' + (r.kind === 'pdf' ? ' pdf' : '') }, r.kind === 'pdf' ? 'PDF' : '網頁'),
        el('span', {}, r.label, r.desc ? el('small', {}, r.desc) : null));
      if (p) a.addEventListener('click', () => { if (!p.res) { p.res = true; progress(I); } });
      body.append(a);
    });
  }

  if (p && I.quiz.length) body.append(el('h3', {}, '✏️ 隨堂測驗'), el('p', { class: 'note' }, `共 ${I.quiz.length} 題，答對 ${passMark(I)} 題以上過關。`), quizEl(I, p));
  if (p && p.done) body.append(el('div', { class: 'stamp-big' }, `★ 已獲得「${I.name}」島章`));

  if (isCenter) {
    const left = OPEN.length - doneCount();
    const certBtn = el('button', { class: 'btn' + (left ? '' : ' done'), type: 'button' }, left ? `還差 ${left} 個島章才能領證書` : '🎓 領取結業證書');
    certBtn.disabled = left > 0;
    certBtn.onclick = makeCertificate;
    const resetBtn = el('button', { class: 'btn', type: 'button', style: 'margin-left:8px;border-color:#FF4FD8' }, '重設進度');
    resetBtn.onclick = () => { if (confirm('確定要清除這台裝置上的名字和所有島章嗎？')) { S = { name: '', char: S.char, music: S.music, prog: {} }; save(); refreshStamps(); openPanel('plaza'); } };
    body.append(el('h3', {}, '🎓 證書'), certBtn, resetBtn);
  }

  $('#panel').hidden = false;
  $('#panel').scrollTop = 0;
  playTrack(I.music);
}

function closePanel() {
  const id = openId;
  $('#panel').hidden = true;
  $('#panelBody').replaceChildren();
  document.body.classList.remove('panel-open');
  openId = null;
  // 角色從傳送陣走出來，往廣場方向站一步
  if (id && byId[id]) {
    const I = byId[id];
    const out = new THREE.Vector3(-I.x, 0, -I.z);
    if (out.lengthSq() < 0.01) out.set(0, 0, 1);
    out.setLength(PORTAL_R + 1.4);
    player.pos.set(I.x + out.x, 0, I.z + out.z);
    player.lockId = id;
  }
  entering = null;
  player.frozen = false;
  playTrack(DATA.center.music);
}
$('#closeBtn').onclick = closePanel;

const passMark = I => Math.ceil(I.quiz.length * 2 / 3);
function quizEl(I, p) {
  const box = el('div');
  let score = 0, answered = 0;
  I.quiz.forEach((item, qi) => {
    const card = el('div', { class: 'q' }, el('p', {}, `${qi + 1}. ${item.q}`));
    const fb = el('p', { class: 'fb' });
    item.options.forEach((opt, oi) => {
      const b = el('button', { class: 'opt', type: 'button' }, opt);
      b.onclick = () => {
        const btns = card.querySelectorAll('button.opt');
        btns.forEach(x => { x.disabled = true; });
        const ok = oi === item.answer;
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) btns[item.answer].classList.add('right');
        fb.textContent = (ok ? '答對了！' : '再想想：') + (item.explain || '');
        answered++; if (ok) score++;
        if (answered === I.quiz.length) {
          const pass = score >= passMark(I);
          box.append(el('p', { class: 'result' }, pass ? `答對 ${score}/${I.quiz.length}，測驗過關！` : `答對 ${score}/${I.quiz.length}，再挑戰一次吧！`));
          if (pass) { p.quiz = true; progress(I); }
          else box.append(el('button', { class: 'btn', type: 'button', onclick: () => box.replaceWith(quizEl(I, p)) }, '重新作答'));
        }
      };
      card.append(b);
    });
    card.append(fb);
    box.append(card);
  });
  return box;
}

function progress(I) {
  const p = P(I.id);
  if (I._drawSteps) I._drawSteps();
  if (!p.done && p.read && p.res && p.quiz) {
    p.done = true;
    sfx('chime');
    toast(`★ 獲得「${I.name}」島章！`);
    $('#panelBody').append(el('div', { class: 'stamp-big' }, `★ 已獲得「${I.name}」島章`));
    if (doneCount() === OPEN.length) setTimeout(() => toast('🎓 全部島章到手！回星港廣場領證書'), 2800);
  } else if (!p.done) {
    const left = ['read', 'res', 'quiz'].filter(k => !p[k]).length;
    toast(`還差 ${left} 步就能蓋章`);
  }
  save();
  refreshStamps();
}

/* ================= 島嶼清單：點了角色會自己走過去 ================= */
function openDrawer() {
  const body = $('#drawerBody');
  body.replaceChildren();
  const row = I => {
    const st = I.status === 'hold' ? '建設中' : I.id === 'plaza' ? '起點' : (S.prog[I.id] && S.prog[I.id].done ? '★ 已蓋章' : '未完成');
    return el('button', { class: 'isle-row', type: 'button', onclick: () => { $('#drawer').hidden = true; goInto(I.id); } },
      el('img', { src: I.img, alt: '' }), el('span', {}, I.name), el('span', { class: 'st' }, st));
  };
  body.append(el('p', { class: 'note' }, '點一座島，你的角色會自己走過去。'), row(DATA.center));
  [...new Set(DATA.islands.map(i => i.seaName))].forEach(sn => {
    const list = DATA.islands.filter(i => i.seaName === sn);
    body.append(el('div', { class: 'sea-title', style: `color:${list[0].color}` }, sn), ...list.map(row));
  });
  $('#drawer').hidden = false;
}
$('#listBtn').onclick = openDrawer;
$('#drawerClose').onclick = () => { $('#drawer').hidden = true; };

/* ================= 證書 ================= */
function makeCertificate() {
  const cv = document.createElement('canvas');
  cv.width = 1600; cv.height = 1000;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1600, 1000);
  grd.addColorStop(0, '#120a3a'); grd.addColorStop(1, '#3a1a6e');
  g.fillStyle = grd; g.fillRect(0, 0, 1600, 1000);
  g.strokeStyle = '#3EF0FF'; g.lineWidth = 10; g.strokeRect(40, 40, 1520, 920);
  g.strokeStyle = '#FF4FD8'; g.lineWidth = 3; g.strokeRect(62, 62, 1476, 876);
  const font = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  const c = myChar();
  g.textAlign = 'center';
  g.fillStyle = '#3EF0FF'; g.font = `600 34px ${font}`; g.fillText('Gina教室的AI奇蹟・教學群島', 760, 170);
  g.fillStyle = '#FFD27A'; g.font = `900 96px ${font}`; g.fillText('結業證書', 760, 290);
  g.fillStyle = '#ffffff'; g.font = `800 80px ${font}`; g.fillText(S.name || '群島旅人', 760, 440);
  g.fillStyle = '#DDE1FF'; g.font = `500 36px ${font}`;
  g.fillText(`與${c ? c.role + c.name : '旅伴'}一起走遍 ${OPEN.length} 座浮空島，`, 760, 550);
  g.fillText('完成所有教材、資源與隨堂測驗，特頒此證。', 760, 605);
  const d = new Date();
  g.font = `500 30px ${font}`; g.fillStyle = '#B9C0F0';
  g.fillText(`${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`, 760, 860);
  const img = new Image();
  img.onload = () => {
    const h = 760, w = h * img.width / img.height;
    g.drawImage(img, 1540 - w, 960 - h, w, h);
    cv.toBlob(b => {
      if (!b) return;
      const a = el('a', { href: URL.createObjectURL(b), download: '教學群島結業證書.png' });
      document.body.append(a); a.click(); a.remove();
      toast('證書已下載');
    });
  };
  img.src = c ? c.walk : 'img/witch.webp';
}

/* ================= 開場：選角色 ================= */
function renderSelect() {
  const grid = $('#charGrid');
  grid.replaceChildren();
  CHARS.forEach(c => {
    const on = !c.locked && c.id === (myChar() || {}).id;
    const btn = el('button', { class: 'char' + (on ? ' on' : '') + (c.locked ? ' locked' : ''), type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': `${c.role}${c.name}${c.locked ? '（待召喚）' : ''}` },
      c.locked ? el('span', { class: 'sil' }) : el('img', { src: c.walk, alt: '' }),
      c.locked ? el('span', { class: 'lock' }, '🔒 待召喚') : null,
      el('span', { class: 'nm' }, c.name));
    btn.onclick = () => {
      if (c.locked) { $('#charInfo').replaceChildren(el('b', {}, `${c.role}・${c.name}`), '：還在路上，之後會加入群島。'); return; }
      S.char = c.id; save(); renderSelect(); setPlayerSkin();
    };
    grid.append(btn);
  });
  const c = myChar();
  if (c) $('#charInfo').replaceChildren(el('b', {}, `${c.role}・${c.name}`), `：「${c.line}」`);
}
function openSelect(again) {
  player.frozen = true;
  renderSelect();
  $('#nameInput').value = S.name || '';
  $('#startBtn').textContent = again ? '回到群島' : (S.name ? `歡迎回來，${S.name}！繼續冒險` : '奏起樂章，啟航');
  $('#intro').hidden = false;
}
$('#startBtn').onclick = () => {
  S.name = $('#nameInput').value.trim().slice(0, 12);
  save();
  $('#intro').hidden = true;
  player.frozen = !!openId;
  playTrack(openId ? byId[openId].music : DATA.center.music);
  setTimeout(() => { $('#hint').style.opacity = 0; }, 9000);
};
$('#charBtn').onclick = () => openSelect(true);
$('#musicBtn').textContent = S.music ? '♪ 開' : '♪ 關';
refreshStamps();
openSelect(false);
window.__game = { goInto, player, byId };   // 測試用
