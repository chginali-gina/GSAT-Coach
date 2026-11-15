import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ================= 資料與本機進度 ================= */
const DATA = await fetch('data/islands.json').then(r => r.json());
const ALL = [DATA.center, ...DATA.islands];
const OPEN = DATA.islands.filter(i => i.status === 'open');
const byId = Object.fromEntries(ALL.map(i => [i.id, i]));

const KEY = 'gina-archipelago-3d';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 無痕模式可能不能存 */ } },
};
let S = Object.assign({ name: '', music: true, prog: {} }, store.get());
const save = () => store.set(S);
const P = id => (S.prog[id] = S.prog[id] || { read: false, res: false, quiz: false, done: false });
const doneCount = () => OPEN.filter(i => S.prog[i.id] && S.prog[i.id].done).length;

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

/* ================= 音樂：大廳序曲＋每座島的登島樂章 ================= */
const audio = new Audio();
audio.loop = true;
audio.preload = 'none';
audio.volume = 0.45;
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

/* ================= 3D 場景 ================= */
const stage = $('#stage');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) { renderer = null; }

const lowEnd = (navigator.hardwareConcurrency || 4) <= 4;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
let controls = null;
const clickable = [];
const isleObj = {};      // id → { group, sprite, label, stamp, base }
let flyTo = null;        // 鏡頭飛行目標
const loader = new THREE.TextureLoader();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeLabel(I) {
  const hold = I.status === 'hold';
  const tex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = 'rgba(14,10,46,0.82)';
    g.strokeStyle = I.color;
    g.lineWidth = 6;
    const x = 8, y = 16, rw = w - 16, rh = h - 32, r = 46;
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + rw, y, x + rw, y + rh, r); g.arcTo(x + rw, y + rh, x, y + rh, r);
    g.arcTo(x, y + rh, x, y, r); g.arcTo(x, y, x + rw, y, r); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '800 58px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(I.name + (hold ? '（建設中）' : ''), w / 2, h / 2 + 2, w - 60);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(6.4, 1.6, 1);
  sp.renderOrder = 5;
  return sp;
}

function makeStampTex() {
  return canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 56, 10, 64, 64, 60);
    grd.addColorStop(0, '#FFF3C4'); grd.addColorStop(1, '#E7A935');
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#7A4A00'; g.stroke();
    g.fillStyle = '#7A4A00'; g.font = '900 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('★', 64, 68);
  });
}

let witch = null;
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.5 : 2));
  stage.appendChild(renderer.domElement);

  // 夜空漸層背景
  scene.background = canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#05061c'); grd.addColorStop(0.55, '#1c1052'); grd.addColorStop(1, '#3a1a6e');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x1c1052, 45, 120);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 12;
  controls.maxDistance = 95;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.32;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => { controls.autoRotate = false; flyTo = null; $('#hint').style.opacity = 0; });

  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x3a1a6e, 1.4));

  // 星空
  const sp = [];
  for (let i = 0; i < 1400; i++) {
    const r = 150 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.45;
    sp.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 10, r * Math.sin(ph) * Math.sin(th));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, fog: false, transparent: true, opacity: 0.85 })));

  // 下方的符文大地（用上傳的地面材質）
  const gtex = loader.load('img/ground.webp');
  gtex.colorSpace = THREE.SRGBColorSpace;
  gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
  gtex.repeat.set(14, 14);
  gtex.anisotropy = 4;
  const land = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshLambertMaterial({ map: gtex, color: 0x7a7fc8 }));
  land.rotation.x = -Math.PI / 2;
  land.position.y = -16;
  scene.add(land);

  // 雲海：幾層半透明的光霧
  const cloudTex = canvasTex(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  for (let i = 0; i < (lowEnd ? 14 : 26); i++) {
    const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: i % 3 ? 0xb9a8ff : 0xff9fe8, transparent: true, opacity: 0.22, depthWrite: false }));
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 34;
    c.position.set(Math.cos(a) * r, -7 - Math.random() * 5, Math.sin(a) * r);
    const s = 12 + Math.random() * 16;
    c.scale.set(s, s * 0.5, 1);
    scene.add(c);
  }

  // 島嶼
  const stampTex = makeStampTex();
  ALL.forEach((I, idx) => {
    const g = new THREE.Group();
    g.position.set(I.x, 0, I.z);
    g.userData.phase = idx * 0.7;
    const size = I.id === 'plaza' ? 8.5 : 6.2;

    // 島下方的光環
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.32, size * 0.42, 48),
      new THREE.MeshBasicMaterial({ color: I.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -2.4;
    g.add(halo);

    const mat = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.08 });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0.42);
    sprite.visible = false;
    loader.load(I.img, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex; mat.needsUpdate = true;
      sprite.scale.set(size * tex.image.width / tex.image.height, size, 1);
      sprite.visible = true;
    });
    if (I.status === 'hold') mat.color.set(0x9a9ac0);
    sprite.userData.id = I.id;
    clickable.push(sprite);
    g.add(sprite);

    const label = makeLabel(I);
    label.position.y = -size * 0.56;
    label.userData.id = I.id;
    clickable.push(label);
    g.add(label);

    const stamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: stampTex, transparent: true, depthWrite: false }));
    stamp.scale.set(1.3, 1.3, 1);
    stamp.position.set(size * 0.36, size * 0.5, 0);
    stamp.visible = false;
    g.add(stamp);

    scene.add(g);
    isleObj[I.id] = { group: g, sprite, label, stamp, size };
  });

  // 嚮導露娜（頭像徽章）會飛到你選的島
  const wtex = loader.load('img/witch-badge.webp');
  wtex.colorSpace = THREE.SRGBColorSpace;
  witch = new THREE.Sprite(new THREE.SpriteMaterial({ map: wtex, transparent: true, depthWrite: false }));
  witch.scale.set(2.4, 2.4, 1);
  witch.renderOrder = 10;
  witch.userData = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1 };
  scene.add(witch);
  placeWitch('plaza', true);

  // 點擊（拖曳不算）
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 7) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(clickable, false)[0];
    if (hit) visit(hit.object.userData.id);
  });

  // 視窗大小
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
  const fitDist = () => {
    const R = 31, a = Math.min(camera.aspect, 1.35);
    return Math.min(camera.aspect < 0.8 ? 68 : 84, Math.max(44, R / (Math.tan(THREE.MathUtils.degToRad(21)) * a)));
  };
  const d0 = fitDist();
  camera.position.set(0, d0 * 0.68, d0 * 0.73);
  scene.fog.near = d0 * 0.9; scene.fog.far = d0 * 2.6;
  controls.target.set(0, 0, 0);
  controls.update();

  // 動畫
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    for (const id in isleObj) {
      const o = isleObj[id];
      o.group.position.y = Math.sin(t * 0.7 + o.group.userData.phase) * 0.35;
      if (o.stamp.visible) o.stamp.material.rotation = Math.sin(t * 2) * 0.15;
    }
    // 露娜沿弧線飛行
    const wd = witch.userData;
    if (wd.t < 1) {
      wd.t = Math.min(1, wd.t + dt * 1.1);
      const k = wd.t < 0.5 ? 2 * wd.t * wd.t : 1 - Math.pow(-2 * wd.t + 2, 2) / 2;
      tmp.lerpVectors(wd.from, wd.to, k);
      tmp.y += Math.sin(Math.PI * k) * 4;
      witch.position.copy(tmp);
    } else if (wd.id) {
      const o = isleObj[wd.id];
      witch.position.set(wd.to.x, o.group.position.y + o.size * 0.62 + Math.sin(t * 2.2) * 0.15, wd.to.z);
    }
    // 鏡頭平滑移到島
    if (flyTo) {
      controls.target.lerp(flyTo.target, 0.08);
      const want = tmp.copy(camera.position).sub(controls.target).setLength(flyTo.dist).add(controls.target);
      camera.position.lerp(want, 0.08);
      if (controls.target.distanceTo(flyTo.target) < 0.05 && Math.abs(camera.position.distanceTo(controls.target) - flyTo.dist) < 0.3) flyTo = null;
    }
    controls.update();
    renderer.render(scene, camera);
  });

  window.__fitDist = fitDist;
} else {
  stage.append(el('p', { style: 'position:absolute;top:40%;width:100%;text-align:center;color:#B9C0F0' }, '這台裝置無法顯示 3D，請用右上角「☰ 島嶼」登島。'));
}

function placeWitch(id, instant) {
  if (!witch) return;
  const o = isleObj[id];
  const wd = witch.userData;
  wd.from.copy(witch.position);
  wd.to.set(o.group.position.x, o.size * 0.62, o.group.position.z);
  wd.id = id;
  if (instant) { witch.position.copy(wd.to); wd.t = 1; } else wd.t = 0;
}

function refreshStamps() {
  for (const I of OPEN) if (isleObj[I.id]) isleObj[I.id].stamp.visible = !!(S.prog[I.id] && S.prog[I.id].done);
  $('#stamps').textContent = `🏅 ${doneCount()} / ${OPEN.length}`;
}

/* ================= 登島 ================= */
let openId = null;
function visit(id) {
  const I = byId[id];
  if (!I) return;
  placeWitch(id);
  if (controls) {
    controls.autoRotate = false;
    flyTo = { target: new THREE.Vector3(I.x, 0, I.z), dist: id === 'plaza' ? 30 : 22 };
  }
  setTimeout(() => openPanel(id), renderer ? 450 : 0);
}

function videoEl(v) {
  const box = el('div', { class: 'video' });
  if (v.type === 'youtube') {
    box.append(el('iframe', { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}`, title: 'YouTube 影片', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: '' }));
  } else {
    const vd = el('video', { src: v.src, controls: '', playsinline: '', preload: 'metadata' });
    box.append(vd);
  }
  return box;
}

function openPanel(id) {
  const I = byId[id];
  openId = id;
  $('#drawer').hidden = true;
  const body = $('#panelBody');
  body.replaceChildren();
  body.style.setProperty('--c', I.color);
  const isCenter = id === 'plaza', hold = I.status === 'hold';
  const p = isCenter || hold ? null : P(id);

  body.append(
    el('div', { class: 'isle-head' },
      el('img', { src: I.img, alt: '' }),
      el('div', {},
        el('span', { class: 'sea' }, I.seaName),
        el('h2', {}, I.name),
        el('div', { class: 'en' }, I.en))),
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
    const drawSteps = () => steps.replaceChildren(
      el('span', { class: p.read ? 'on' : '' }, (p.read ? '✓ ' : '① ') + '讀教材'),
      el('span', { class: p.res ? 'on' : '' }, (p.res ? '✓ ' : '② ') + '開一項資源'),
      el('span', { class: p.quiz ? 'on' : '' }, (p.quiz ? '✓ ' : '③ ') + '測驗過關'));
    drawSteps();
    body.append(steps);
    I._drawSteps = drawSteps;
  }

  // 教材
  body.append(el('h3', {}, isCenter ? '🗺️ 群島導覽' : hold ? '🏗️ 施工中' : '📖 教材'));
  I.sections.forEach(s => body.append(el('div', { class: 'sec' }, el('b', {}, s.title), el('p', {}, s.body))));
  if (p) {
    const readBtn = el('button', { class: 'btn' + (p.read ? ' done' : ''), type: 'button' }, p.read ? '✓ 已讀完' : '我讀完了');
    readBtn.onclick = () => { p.read = true; readBtn.textContent = '✓ 已讀完'; readBtn.classList.add('done'); progress(I); };
    body.append(readBtn);
  }

  // 影片（在 islands.json 加 "video" 就會出現）
  if (I.video) body.append(el('h3', {}, '🎬 影片'), videoEl(I.video));

  // 資源
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

  // 測驗
  if (p && I.quiz.length) {
    body.append(el('h3', {}, '✏️ 隨堂測驗'), el('p', { class: 'note' }, `共 ${I.quiz.length} 題，答對 ${passMark(I)} 題以上過關。`), quizEl(I, p));
  }

  if (p && p.done) body.append(el('div', { class: 'stamp-big' }, `★ 已獲得「${I.name}」島章`));

  if (isCenter) {
    const left = OPEN.length - doneCount();
    const certBtn = el('button', { class: 'btn' + (left ? '' : ' done'), type: 'button' }, left ? `還差 ${left} 個島章才能領證書` : '🎓 領取結業證書');
    certBtn.disabled = left > 0;
    certBtn.onclick = makeCertificate;
    const resetBtn = el('button', { class: 'btn', type: 'button', style: 'margin-left:8px;border-color:#FF4FD8' }, '重設進度');
    resetBtn.onclick = () => { if (confirm('確定要清除這台裝置上的名字和所有島章嗎？')) { S = { name: '', music: S.music, prog: {} }; save(); refreshStamps(); openPanel('plaza'); } };
    body.append(el('h3', {}, '🎓 證書'), certBtn, resetBtn);
  }

  $('#panel').hidden = false;
  $('#panel').scrollTop = 0;
  playTrack(I.music);
}

function closePanel() {
  $('#panel').hidden = true;
  $('#panelBody').replaceChildren();
  openId = null;
  placeWitch('plaza');
  if (controls && window.__fitDist) flyTo = { target: new THREE.Vector3(0, 0, 0), dist: window.__fitDist() };
  playTrack(DATA.center.music);
}
$('#closeBtn').onclick = closePanel;
addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#panel').hidden) closePanel(); $('#drawer').hidden = true; } });

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

/* ================= 島嶼清單（也是無 3D 時的備援） ================= */
function openDrawer() {
  const body = $('#drawerBody');
  body.replaceChildren();
  const row = I => {
    const st = I.status === 'hold' ? '建設中' : I.id === 'plaza' ? '起點' : (S.prog[I.id] && S.prog[I.id].done ? '★ 已蓋章' : '未完成');
    return el('button', { class: 'isle-row', type: 'button', onclick: () => { $('#drawer').hidden = true; visit(I.id); } },
      el('img', { src: I.img, alt: '' }), el('span', {}, I.name), el('span', { class: 'st' }, st));
  };
  body.append(row(DATA.center));
  const seas = [...new Set(DATA.islands.map(i => i.seaName))];
  seas.forEach(sn => {
    const list = DATA.islands.filter(i => i.seaName === sn);
    body.append(el('div', { class: 'sea-title', style: `color:${list[0].color}` }, sn), ...list.map(row));
  });
  $('#drawer').hidden = false;
}
$('#listBtn').onclick = openDrawer;
$('#drawerClose').onclick = () => { $('#drawer').hidden = true; };

/* ================= 證書 ================= */
function makeCertificate() {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1000;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1600, 1000);
  grd.addColorStop(0, '#120a3a'); grd.addColorStop(1, '#3a1a6e');
  g.fillStyle = grd; g.fillRect(0, 0, 1600, 1000);
  g.strokeStyle = '#3EF0FF'; g.lineWidth = 10; g.strokeRect(40, 40, 1520, 920);
  g.strokeStyle = '#FF4FD8'; g.lineWidth = 3; g.strokeRect(62, 62, 1476, 876);
  const font = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#3EF0FF'; g.font = `600 34px ${font}`; g.fillText('Gina教室的AI奇蹟・教學群島', 800, 170);
  g.fillStyle = '#FFD27A'; g.font = `900 96px ${font}`; g.fillText('結業證書', 800, 290);
  g.fillStyle = '#ffffff'; g.font = `800 80px ${font}`; g.fillText(S.name || '群島旅人', 800, 450);
  g.fillStyle = '#DDE1FF'; g.font = `500 38px ${font}`;
  g.fillText(`走遍 ${OPEN.length} 座浮空島，完成所有教材、資源與隨堂測驗。`, 800, 560);
  g.fillText('特頒此證，表揚你的好奇與堅持。', 800, 620);
  const d = new Date();
  g.font = `500 30px ${font}`; g.fillStyle = '#B9C0F0';
  g.fillText(`${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日・嚮導 露娜`, 800, 860);
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 1260, 640, 240, 240);
    c.toBlob(b => {
      if (!b) return;
      const a = el('a', { href: URL.createObjectURL(b), download: '教學群島結業證書.png' });
      document.body.append(a); a.click(); a.remove();
      toast('證書已下載');
    });
  };
  img.src = 'img/witch-badge.webp';
}

/* ================= 開場 ================= */
$('#nameInput').value = S.name || '';
if (S.name) $('#startBtn').textContent = `歡迎回來，${S.name}！繼續冒險`;
$('#musicBtn').textContent = S.music ? '♪ 開' : '♪ 關';
$('#startBtn').onclick = () => {
  S.name = $('#nameInput').value.trim().slice(0, 12);
  save();
  $('#intro').hidden = true;
  playTrack(DATA.center.music);
  setTimeout(() => { $('#hint').style.opacity = 0; }, 7000);
};
refreshStamps();
window.__visit = visit;   // 測試用
