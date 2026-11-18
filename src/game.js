/* StreeFight — 原创 2D 格斗游戏 (纯 Canvas, 无依赖) */
(() => {
'use strict';

const W = 960, H = 540, GROUND = 452, GRAV = 0.7, WALK = 3.6, JUMP = -13.5;
const ROUND_TIME = 60, WINS_NEEDED = 2;
const FONT = '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// 招式表: startup 起手, active 判定, total 总帧数
const ATK = {
  punch:   { startup: 5,  active: 4, total: 17, dmg: 6,  range: 82,  kb: 5 },
  kick:    { startup: 8,  active: 5, total: 27, dmg: 10, range: 108, kb: 7 },
  special: { startup: 14, active: 0, total: 36, dmg: 14, cost: 35 },
};

const CHARS = [
  { name: '岚', sub: 'LAN', body: '#2f7bff', trim: '#bfe0ff', skin: '#f2c9a0', fx: '#6fd0ff' },
  { name: '焰', sub: 'YAN', body: '#e23b3b', trim: '#ffd27a', skin: '#e0ad84', fx: '#ffb347' },
];

/* ---------- 输入 ---------- */
const keys = new Set(), pressed = new Set();
const KEYMAP = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
    punch: ['KeyJ'], kick: ['KeyK'], special: ['KeyL'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    punch: ['Comma', 'Numpad1'], kick: ['Period', 'Numpad2'], special: ['Slash', 'Numpad3'] },
];
const GAME_KEYS = new Set(KEYMAP.flatMap(m => Object.values(m).flat()).concat(['Space', 'Enter']));

window.addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
  initAudio();
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput(i) {
  const m = KEYMAP[i], any = (list, set) => list.some(k => set.has(k));
  return {
    left: any(m.left, keys), right: any(m.right, keys), up: any(m.up, keys), down: any(m.down, keys),
    punch: any(m.punch, pressed), kick: any(m.kick, pressed), special: any(m.special, pressed),
  };
}

/* ---------- 音效 (WebAudio 合成) ---------- */
let actx = null;
function initAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { actx = null; }
}
function beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  swing: () => beep(320, 0.07, 'triangle', 0.05, -180),
  hit:   () => { beep(160, 0.12, 'sawtooth', 0.12, -110); beep(90, 0.1, 'square', 0.08, -40); },
  block: () => beep(520, 0.05, 'square', 0.05, -100),
  fire:  () => beep(240, 0.3, 'sawtooth', 0.07, 500),
  ko:    () => beep(220, 0.9, 'sawtooth', 0.12, -180),
  bell:  () => beep(880, 0.35, 'triangle', 0.1),
  ui:    () => beep(660, 0.08, 'square', 0.05),
};

/* ---------- 游戏状态 ---------- */
const G = {
  scene: 'menu',      // menu | intro | fight | roundEnd | matchEnd
  mode: 'cpu',        // cpu | pvp
  level: 1,           // 0 简单 1 普通 2 困难
  paused: false,
  round: 1, timer: ROUND_TIME, frame: 0, sceneT: 0,
  shake: 0, hitstop: 0, banner: '',
  fighters: [], shots: [], sparks: [],
  ai: { plan: 'idle', t: 0, fresh: false },
  menuSel: 0,
};

function makeFighter(i) {
  return {
    i, ch: CHARS[i], x: i ? W - 260 : 260, y: GROUND, vx: 0, vy: 0, facing: i ? -1 : 1,
    hp: 100, shownHp: 100, energy: 0, state: 'idle', t: 0, hasHit: false,
    blocking: false, walk: 0, wins: 0,
  };
}

function startMatch(mode) {
  G.mode = mode; G.round = 1;
  G.fighters = [makeFighter(0), makeFighter(1)];
  startRound();
}

function startRound() {
  const wins = G.fighters.map(f => f.wins);
  G.fighters = [makeFighter(0), makeFighter(1)];
  G.fighters.forEach((f, i) => f.wins = wins[i]);
  G.shots = []; G.sparks = [];
  G.timer = ROUND_TIME; G.frame = 0; G.scene = 'intro'; G.sceneT = 0;
  G.ai = { plan: 'idle', t: 0, fresh: false };
}

/* ---------- AI ---------- */
function aiInput(me, opp) {
  const inp = { left: false, right: false, up: false, down: false, punch: false, kick: false, special: false };
  const ai = G.ai, lv = G.level;
  const dist = Math.abs(opp.x - me.x);
  const toward = opp.x > me.x ? 'right' : 'left', away = opp.x > me.x ? 'left' : 'right';
  const react = [0.25, 0.55, 0.85][lv];

  // 应对飞行道具
  const threat = G.shots.find(s => s.owner !== me && Math.abs(s.x - me.x) < 150 && Math.sign(s.vx) === Math.sign(me.x - s.x));
  if (threat && ai.plan !== 'dodge' && Math.random() < react * 0.3) {
    ai.plan = 'dodge'; ai.t = 26; ai.dodge = Math.random() < 0.5 ? 'jump' : (Math.random() < 0.5 ? 'crouch' : 'block'); ai.fresh = true;
  }
  // 对手出招时防御
  if (ATK[opp.state] && opp.state !== 'special' && dist < 125 && ai.plan !== 'block' && ai.plan !== 'dodge' && Math.random() < react * 0.25) {
    ai.plan = 'block'; ai.t = 16; ai.fresh = true;
  }

  if (--ai.t <= 0) {
    const r = Math.random();
    ai.fresh = true;
    if (dist > 330) {
      if (me.energy >= ATK.special.cost && r < 0.3 + lv * 0.1) ai.plan = 'special';
      else if (r < 0.85) ai.plan = 'approach';
      else ai.plan = 'idle';
    } else if (dist > 115) {
      if (r < 0.55) ai.plan = 'approach';
      else if (r < 0.65 && me.energy >= ATK.special.cost) ai.plan = 'special';
      else if (r < 0.75) ai.plan = 'jumpin';
      else if (r < 0.88) ai.plan = 'retreat';
      else ai.plan = 'idle';
    } else {
      const aggro = [0.45, 0.65, 0.8][lv];
      if (r < aggro * 0.5) ai.plan = 'punch';
      else if (r < aggro) ai.plan = 'kick';
      else if (r < aggro + 0.12) ai.plan = 'block';
      else if (r < aggro + 0.2) ai.plan = 'retreat';
      else ai.plan = 'idle';
    }
    ai.t = [26, 16, 10][lv] + Math.floor(Math.random() * 14);
  }

  switch (ai.plan) {
    case 'approach': inp[toward] = true; break;
    case 'retreat':  inp[away] = true; break;
    case 'block':    inp[away] = true; break;
    case 'jumpin':   inp[toward] = true; inp.up = ai.fresh; if (me.y < GROUND - 40 && dist < 110) inp.kick = Math.random() < 0.2; break;
    case 'punch':    inp.punch = ai.fresh; break;
    case 'kick':     inp.kick = ai.fresh; break;
    case 'special':  inp.special = ai.fresh; break;
    case 'dodge':
      if (ai.dodge === 'jump') inp.up = ai.fresh;
      else if (ai.dodge === 'crouch') inp.down = true;
      else inp[away] = true;
      break;
  }
  ai.fresh = false;
  return inp;
}

/* ---------- 战斗逻辑 ---------- */
const grounded = f => f.y >= GROUND;
const crouching = f => f.state === 'crouch';

function spark(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
    G.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 14 + Math.random() * 10, color });
  }
}

function applyHit(v, atk, dir, dmg, kb, hx, hy) {
  if (v.state === 'ko') return;
  if (v.blocking) {
    v.hp -= dmg * 0.15; v.state = 'blockstun'; v.t = 11; v.vx = dir * kb * 0.7;
    spark(hx, hy, '#cfe8ff', 5); sfx.block();
    atk.energy = Math.min(100, atk.energy + 3);
  } else {
    v.hp -= dmg; v.state = 'hit'; v.t = 17; v.vx = dir * kb;
    if (!grounded(v)) v.vy = -5;
    spark(hx, hy, '#fff3a0', 12); sfx.hit();
    G.shake = 8; G.hitstop = 4;
    atk.energy = Math.min(100, atk.energy + 9);
    v.energy = Math.min(100, v.energy + 5);
  }
  if (v.hp <= 0) {
    v.hp = 0; v.state = 'ko'; v.t = 0; v.vx = dir * 7; v.vy = -8; v.blocking = false;
    G.shake = 16; G.hitstop = 10; sfx.ko();
  }
}

function startAttack(f, name) {
  f.state = name; f.t = 0; f.hasHit = false;
  if (name === 'special') f.energy -= ATK.special.cost; else sfx.swing();
}

function updateFighter(f, opp, inp) {
  f.energy = Math.min(100, f.energy + 0.04);
  const onGround = grounded(f);
  let free = f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'jump';

  if (f.state === 'hit' || f.state === 'blockstun') {
    f.blocking = f.state === 'blockstun';
    if (--f.t <= 0) { f.state = onGround ? 'idle' : 'jump'; f.blocking = false; }
  } else if (f.state === 'ko') {
    f.t++;
  } else if (ATK[f.state]) {
    const a = ATK[f.state];
    f.blocking = false; f.t++;
    if (f.state === 'special') {
      if (f.t === a.startup) {
        G.shots.push({ x: f.x + f.facing * 50, y: f.y - 80, vx: f.facing * 8, owner: f, life: 120, dmg: a.dmg });
        sfx.fire();
      }
    } else if (f.t >= a.startup && f.t < a.startup + a.active && !f.hasHit) {
      const dx = (opp.x - f.x) * f.facing;
      if (dx > -15 && dx < a.range && Math.abs(opp.y - f.y) < 75 && opp.state !== 'ko') {
        f.hasHit = true;
        const hy = f.state === 'punch' ? f.y - 88 : f.y - 60;
        applyHit(opp, f, f.facing, a.dmg, a.kb, (f.x + opp.x) / 2 + f.facing * 12, Math.min(hy, opp.y - 30));
      }
    }
    if (f.t >= a.total) f.state = onGround ? 'idle' : 'jump';
  } else if (free) {
    if (onGround) {
      f.facing = opp.x >= f.x ? 1 : -1;
      const back = f.facing === 1 ? inp.left : inp.right;
      f.blocking = back;
      if (inp.special && f.energy >= ATK.special.cost) { startAttack(f, 'special'); f.vx = 0; }
      else if (inp.kick) { startAttack(f, 'kick'); f.vx = 0; }
      else if (inp.punch) { startAttack(f, 'punch'); f.vx = 0; }
      else if (inp.up) {
        f.state = 'jump'; f.vy = JUMP; f.vx = inp.right ? WALK * 1.15 : inp.left ? -WALK * 1.15 : 0; f.blocking = false;
      } else if (inp.down) { f.state = 'crouch'; f.vx = 0; }
      else if (inp.left !== inp.right) {
        f.state = 'walk'; f.vx = (inp.right ? WALK : -WALK) * (back ? 0.75 : 1); f.walk += 0.22;
      } else { f.state = 'idle'; f.vx = 0; }
    } else {
      f.state = 'jump'; f.blocking = false;
      if (inp.kick) startAttack(f, 'kick'); else if (inp.punch) startAttack(f, 'punch');
    }
  }

  // 物理
  if (grounded(f) && (f.state === 'hit' || f.state === 'blockstun' || f.state === 'ko')) f.vx *= 0.85;
  f.x += f.vx; f.vy += GRAV; f.y += f.vy;
  if (f.y >= GROUND) {
    f.y = GROUND; f.vy = 0;
    if (f.state === 'jump') { f.state = 'idle'; f.vx = 0; }
    else if (ATK[f.state]) f.vx = 0;
  }
  f.x = Math.max(40, Math.min(W - 40, f.x));
  f.shownHp += (f.hp - f.shownHp) * 0.12;
}

function updateShots() {
  for (const s of G.shots) {
    s.x += s.vx; s.life--;
    if (s.x < -40 || s.x > W + 40) s.life = 0;
    for (const o of G.shots) {
      if (o !== s && o.owner !== s.owner && o.life > 0 && s.life > 0 && Math.abs(o.x - s.x) < 26) {
        spark((o.x + s.x) / 2, s.y, '#ffffff', 14); o.life = s.life = 0; sfx.block();
      }
    }
    const v = G.fighters[1 - s.owner.i];
    if (s.life > 0 && v.state !== 'ko') {
      const top = v.y - (crouching(v) ? 70 : 122);
      if (Math.abs(s.x - v.x) < 30 && s.y > top && s.y < v.y) {
        applyHit(v, s.owner, Math.sign(s.vx), s.dmg, 7, s.x, s.y); s.life = 0;
      }
    }
  }
  G.shots = G.shots.filter(s => s.life > 0);
}

function endRound(winner) {
  G.scene = 'roundEnd'; G.sceneT = 0;
  if (winner) { winner.wins++; G.banner = 'K.O.'; }
  else G.banner = '平局';
}

function step() {
  if (pressed.has('Escape') && G.scene !== 'menu') {
    G.paused = !G.paused; sfx.ui();
  }
  if (G.paused) {
    if (pressed.has('KeyQ')) { G.paused = false; G.scene = 'menu'; }
    pressed.clear(); return;
  }

  G.sparks.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.life--; });
  G.sparks = G.sparks.filter(p => p.life > 0);
  if (G.shake > 0) G.shake--;

  if (G.scene === 'menu') {
    if (pressed.has('ArrowUp') || pressed.has('KeyW')) { G.menuSel = (G.menuSel + 2) % 3; sfx.ui(); }
    if (pressed.has('ArrowDown') || pressed.has('KeyS')) { G.menuSel = (G.menuSel + 1) % 3; sfx.ui(); }
    if (G.menuSel === 2 && (pressed.has('ArrowLeft') || pressed.has('KeyA'))) { G.level = (G.level + 2) % 3; sfx.ui(); }
    if (G.menuSel === 2 && (pressed.has('ArrowRight') || pressed.has('KeyD') || pressed.has('Enter') || pressed.has('Space'))) { G.level = (G.level + 1) % 3; sfx.ui(); }
    else if (pressed.has('Enter') || pressed.has('Space')) { if (G.menuSel < 2) { sfx.bell(); startMatch(G.menuSel === 0 ? 'cpu' : 'pvp'); } }
    if (pressed.has('Digit1')) { sfx.bell(); startMatch('cpu'); }
    if (pressed.has('Digit2')) { sfx.bell(); startMatch('pvp'); }
    pressed.clear(); return;
  }

  if (G.hitstop > 0) { G.hitstop--; pressed.clear(); return; }
  const [a, b] = G.fighters;
  const none = { left: false, right: false, up: false, down: false, punch: false, kick: false, special: false };
  G.sceneT++;

  if (G.scene === 'intro') {
    updateFighter(a, b, none); updateFighter(b, a, none);
    if (G.sceneT === 70) sfx.bell();
    if (G.sceneT > 110) { G.scene = 'fight'; G.sceneT = 0; }
  } else if (G.scene === 'fight') {
    const ia = readInput(0), ib = G.mode === 'pvp' ? readInput(1) : aiInput(b, a);
    updateFighter(a, b, ia); updateFighter(b, a, ib);
    // 防止重叠
    if (grounded(a) && grounded(b) && Math.abs(a.x - b.x) < 46) {
      const push = (46 - Math.abs(a.x - b.x)) / 2, d = a.x <= b.x ? -1 : 1;
      a.x = Math.max(40, Math.min(W - 40, a.x + d * push));
      b.x = Math.max(40, Math.min(W - 40, b.x - d * push));
    }
    updateShots();
    G.frame++;
    if (G.frame % 60 === 0 && G.timer > 0) G.timer--;
    if (a.hp <= 0 || b.hp <= 0) endRound(a.hp <= 0 && b.hp <= 0 ? null : a.hp > 0 ? a : b);
    else if (G.timer <= 0) {
      G.banner = '时间到';
      const w = a.hp === b.hp ? null : a.hp > b.hp ? a : b;
      G.scene = 'roundEnd'; G.sceneT = 0; if (w) w.wins++; sfx.bell();
    }
  } else if (G.scene === 'roundEnd') {
    updateFighter(a, b, none); updateFighter(b, a, none); updateShots();
    if (G.sceneT > 170) {
      if (a.wins >= WINS_NEEDED || b.wins >= WINS_NEEDED) { G.scene = 'matchEnd'; G.sceneT = 0; }
      else { G.round++; startRound(); }
    }
  } else if (G.scene === 'matchEnd') {
    updateFighter(a, b, none); updateFighter(b, a, none);
    if (G.sceneT > 40 && (pressed.has('Enter') || pressed.has('Space'))) { G.scene = 'menu'; sfx.ui(); }
  }
  pressed.clear();
}

/* ---------- 绘制 ---------- */
const skyline = Array.from({ length: 26 }, (_, i) => ({
  x: i * 40 - 20, w: 34 + (i * 37 % 22), h: 70 + (i * 53 % 150),
  win: Array.from({ length: 24 }, (_, k) => ((i * 7 + k * 13) % 5) < 2),
}));

function drawStage() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#1a1038'); g.addColorStop(0.55, '#6a2a5e'); g.addColorStop(1, '#f08a4b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 夕阳
  ctx.fillStyle = 'rgba(255,214,130,.9)'; ctx.beginPath(); ctx.arc(690, 330, 80, 0, Math.PI * 2); ctx.fill();
  // 楼群
  for (const b of skyline) {
    ctx.fillStyle = '#1b1430'; ctx.fillRect(b.x, GROUND - 40 - b.h, b.w, b.h + 40);
    ctx.fillStyle = 'rgba(255,205,120,.55)';
    b.win.forEach((on, k) => { if (on) { const wx = b.x + 5 + (k % 3) * 10, wy = GROUND - 30 - b.h + Math.floor(k / 3) * 18; if (wy < GROUND - 50) ctx.fillRect(wx, wy, 5, 8); } });
  }
  // 地面
  const gg = ctx.createLinearGradient(0, GROUND - 20, 0, H);
  gg.addColorStop(0, '#3a3348'); gg.addColorStop(1, '#15121f');
  ctx.fillStyle = gg; ctx.fillRect(0, GROUND - 20, W, H - GROUND + 20);
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;
  for (let i = -6; i < 18; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 40, GROUND - 20); ctx.lineTo(W / 2 + i * 150, H); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(0, GROUND - 20, W, 2);
}

function limb(x1, y1, x2, y2, bend, w, color) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx - dy / len * bend, my + dx / len * bend, x2, y2); ctx.stroke();
}

function drawFighter(f) {
  const c = f.ch, st = f.state;
  // 影子
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(f.x, GROUND + 4, 38 - Math.min(18, (GROUND - f.y) / 8), 7, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save(); ctx.translate(f.x, f.y); ctx.scale(f.facing, 1);
  const crouch = st === 'crouch';
  const bob = st === 'idle' ? Math.sin(G.frame * 0.12 + f.i) * 1.5 : 0;
  let hipY = crouch ? -36 : -58, shY = (crouch ? -72 : -106) + bob, lean = 0;
  let ext = 0;
  if (ATK[st]) { const a = ATK[st]; ext = Math.sin(Math.min(1, f.t / (a.startup + 4)) * Math.PI * 0.5) * (f.t > a.startup + 6 ? Math.max(0, 1 - (f.t - a.startup - 6) / (a.total - a.startup - 6)) : 1); }
  if (st === 'hit') lean = -0.3;
  if (st === 'blockstun') lean = -0.1;
  if (st === 'ko') { lean = -Math.PI / 2 * Math.min(1, f.t / 18); }
  if (st === 'punch' || st === 'special') lean = 0.12 * ext;
  if (st === 'kick') lean = -0.25 * ext;
  if (st === 'ko' && grounded(f)) ctx.translate(0, -10);
  ctx.rotate(lean);

  // 腿
  let f1 = [16, 0], f2 = [-16, 0];
  if (st === 'walk') { const s = Math.sin(f.walk) * 16; f1 = [14 + s, -Math.max(0, -Math.sin(f.walk + 1.5)) * 8]; f2 = [-14 - s, -Math.max(0, Math.sin(f.walk + 1.5)) * 8]; }
  if (st === 'jump' || (!grounded(f) && st !== 'ko' && st !== 'kick')) { f1 = [14, -22]; f2 = [-10, -12]; }
  if (crouch) { f1 = [22, 0]; f2 = [-20, 0]; }
  if (st === 'kick') { f1 = [20 + 84 * ext, -66 * ext]; f2 = [-12, grounded(f) ? 0 : -14]; }
  limb(-5, hipY, f2[0], f2[1], crouch ? -14 : -6, 13, '#23232e');
  limb(5, hipY, f1[0], f1[1], st === 'kick' ? -4 * (1 - ext) : (crouch ? 16 : 7), 13, '#2c2c3a');
  // 鞋
  ctx.fillStyle = c.trim; for (const p of [f2, f1]) { ctx.beginPath(); ctx.ellipse(p[0] + 4, p[1] - 3, 10, 5, 0, 0, Math.PI * 2); ctx.fill(); }

  // 后臂
  let h1 = [26, shY + 22], h2 = [12, shY + 30];
  if (f.blocking && st !== 'hit') { h1 = [22, shY - 6]; h2 = [18, shY + 8]; }
  if (st === 'punch') { h1 = [24 + 60 * ext, shY + 6]; h2 = [6, shY + 26]; }
  if (st === 'special') { h1 = [20 + 44 * ext, shY + 18]; h2 = [16 + 44 * ext, shY + 30]; }
  if (st === 'hit' || st === 'ko') { h1 = [18, shY - 16]; h2 = [-16, shY - 6]; }
  if (st === 'kick') { h1 = [10, shY + 22]; h2 = [-18, shY + 12]; }
  limb(-4, shY + 6, h2[0], h2[1], 8, 10, c.skin);

  // 躯干
  limb(0, hipY, 0, shY + 4, crouch ? -8 : 0, 26, c.body);
  ctx.strokeStyle = c.trim; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-13, hipY + 2); ctx.lineTo(13, hipY + 2); ctx.stroke();
  // 头
  const hy = shY - 18;
  ctx.fillStyle = c.skin; ctx.beginPath(); ctx.arc(3, hy, 15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c.body; ctx.lineWidth = 6; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.arc(3, hy, 15, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  const tail = Math.sin(G.frame * 0.2 + f.i * 2) * 4;
  limb(-11, hy - 5, -30, hy + 2 + tail, 4, 4, c.body);
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(9, hy - 2, 5, st === 'hit' || st === 'ko' ? 2 : 4);
  // 前臂 + 拳
  limb(4, shY + 6, h1[0], h1[1], st === 'punch' ? -6 * (1 - ext) : -9, 10, c.skin);
  ctx.fillStyle = c.trim; ctx.beginPath(); ctx.arc(h1[0], h1[1], 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(h2[0], h2[1], 7, 0, Math.PI * 2); ctx.fill();
  // 蓄力光
  if (st === 'special' && f.t < ATK.special.startup) {
    ctx.fillStyle = c.fx; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(46, shY + 24, 6 + f.t, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawShot(s) {
  const c = s.owner.ch.fx, r = 16 + Math.sin(G.frame * 0.5) * 3;
  const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, r + 12);
  g.addColorStop(0, '#fff'); g.addColorStop(0.4, c); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, r + 12, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.4; ctx.fillStyle = c;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(s.x - Math.sign(s.vx) * i * 14, s.y, r - i * 3.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
}

function text(str, x, y, size, color = '#fff', align = 'center', weight = 800) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size / 9); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineJoin = 'round';
  ctx.strokeText(str, x, y); ctx.fillStyle = color; ctx.fillText(str, x, y);
}

function drawHUD() {
  const [a, b] = G.fighters, bw = 370, bh = 22, y = 34;
  [[a, 40, 1], [b, W - 40, -1]].forEach(([f, x0, d]) => {
    const x = d === 1 ? x0 : x0 - bw;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 3, y - 3, bw + 6, bh + 6);
    ctx.fillStyle = '#5a1620'; ctx.fillRect(x, y, bw, bh);
    const wS = bw * f.shownHp / 100, wH = bw * f.hp / 100;
    ctx.fillStyle = '#fff'; ctx.fillRect(d === 1 ? x + bw - wS : x, y, wS, bh);
    ctx.fillStyle = f.hp > 30 ? '#ffd23f' : '#ff5a3c'; ctx.fillRect(d === 1 ? x + bw - wH : x, y, wH, bh);
    // 能量
    const ew = 180, ex = d === 1 ? x : x + bw - ew, we = ew * f.energy / 100;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(ex - 2, y + bh + 8, ew + 4, 10);
    ctx.fillStyle = f.energy >= ATK.special.cost ? f.ch.fx : '#667';
    ctx.fillRect(d === 1 ? ex : ex + ew - we, y + bh + 10, we, 6);
    const label = `${f.ch.name} ${f.ch.sub}` + (f.i === 1 && G.mode === 'cpu' ? ' · CPU' : f.i === 0 ? ' · P1' : ' · P2');
    text(label, d === 1 ? x : x + bw, y - 16, 16, '#fff', d === 1 ? 'left' : 'right', 700);
    for (let i = 0; i < WINS_NEEDED; i++) {
      ctx.fillStyle = i < f.wins ? '#ffd23f' : 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.arc(d === 1 ? x + bw - 10 - i * 20 : x + 10 + i * 20, y + bh + 15, 6, 0, Math.PI * 2); ctx.fill();
    }
  });
  text(String(G.timer).padStart(2, '0'), W / 2, y + 12, 40, G.timer <= 10 ? '#ff5a3c' : '#fff');
}

function drawMenu() {
  drawStage();
  ctx.fillStyle = 'rgba(8,6,18,.62)'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, 120); ctx.transform(1, 0, -0.18, 1, 0, 0);
  text('STREEFIGHT', 0, 0, 96, '#ffd23f'); ctx.restore();
  text('街 头 对 决', W / 2, 190, 24, '#ffb38a', 'center', 600);
  const items = ['单人模式  vs CPU', '双人对战  本地 2P', `CPU 难度： ${['简单', '普通', '困难'][G.level]}`];
  items.forEach((s, i) => {
    const sel = i === G.menuSel, y = 262 + i * 52;
    if (sel) { ctx.fillStyle = 'rgba(255,210,63,.16)'; ctx.fillRect(W / 2 - 200, y - 22, 400, 44); ctx.fillStyle = '#ffd23f'; ctx.fillRect(W / 2 - 200, y - 22, 5, 44); }
    text(s, W / 2, y, 26, sel ? '#fff' : '#b9b4c8', 'center', sel ? 800 : 600);
  });
  text('↑↓ 选择   Enter 确认   F11 全屏', W / 2, 430, 15, '#c8c3d6', 'center', 500);
  text('P1： A/D 移动  W 跳  S 蹲  J 拳  K 腿  L 气功波      按住「后」防御', W / 2, 470, 15, '#9fd0ff', 'center', 500);
  text('P2： ←/→ 移动  ↑ 跳  ↓ 蹲  ,  .  /  （或小键盘 1 2 3）', W / 2, 496, 15, '#ffb0a0', 'center', 500);
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (G.scene === 'menu') { drawMenu(); return; }
  if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  drawStage();
  const order = G.fighters.slice().sort((p, q) => (ATK[p.state] ? 1 : 0) - (ATK[q.state] ? 1 : 0));
  order.forEach(drawFighter);
  G.shots.forEach(drawShot);
  for (const p of G.sparks) { ctx.globalAlpha = Math.min(1, p.life / 10); ctx.fillStyle = p.color; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHUD();

  if (G.scene === 'intro') {
    if (G.sceneT < 70) text(`ROUND ${G.round}`, W / 2, 220, 72, '#fff');
    else text('FIGHT!', W / 2, 220, 96, '#ffd23f');
  } else if (G.scene === 'roundEnd') {
    text(G.banner, W / 2, 220, 96, '#ff5a3c');
  } else if (G.scene === 'matchEnd') {
    const [a, b] = G.fighters, w = a.wins > b.wins ? a : b;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 150, W, 190);
    text(`${w.ch.name} ${w.ch.sub} 获胜！`, W / 2, 215, 64, w.ch.fx);
    text(G.mode === 'cpu' ? (w.i === 0 ? '你赢了' : '再接再厉') : `玩家 ${w.i + 1} 胜利`, W / 2, 272, 24, '#fff', 'center', 600);
    if (G.sceneT > 40) text('按 Enter 返回主菜单', W / 2, 312, 18, '#ddd', 'center', 500);
  }
  if (G.paused) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
    text('暂停', W / 2, 230, 64);
    text('Esc 继续    Q 返回主菜单', W / 2, 300, 20, '#ddd', 'center', 500);
  }
}

/* ---------- 主循环 (固定 60Hz) ---------- */
let last = 0, acc = 0;
function loop(ts) {
  acc += Math.min(100, ts - last); last = ts;
  while (acc >= 1000 / 60) { step(); acc -= 1000 / 60; }
  draw();
  requestAnimationFrame(loop);
}
canvas.addEventListener('pointerdown', () => { initAudio(); canvas.focus(); });
globalThis.__SF = { G, step, draw, startMatch, keys, pressed };
requestAnimationFrame(ts => { last = ts; loop(ts); });
})();
