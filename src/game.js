/* StreeFight - original retro-style 2D fighter. Pure Canvas + WebAudio, no assets. */
(() => {
'use strict';

/* World units are 960x540; the screen is a 384x216 pixel buffer (S = 0.4). */
const W = 960, H = 540, GROUND = 452, GRAV = 0.7, WALK = 4.2, JUMP = -15.5;
const SW = 384, SH = 216, S = 0.4, SPR = 1.4, EDGE = 56;
const ROUND_TIME = 60, WINS_NEEDED = 2;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Frame data: startup / active / total
const ATK = {
  punch:   { startup: 5,  active: 4, total: 17, dmg: 6,  range: 112, kb: 5 },
  kick:    { startup: 8,  active: 5, total: 27, dmg: 10, range: 150, kb: 7 },
  special: { startup: 14, active: 0, total: 36, dmg: 14, cost: 35 },
};

const CHARS = [
  { name: 'LAN', move: 'AERO BURST', body: '#2f6fe0', dark: '#1b3f96', light: '#6fa8ff', trim: '#e8f2ff',
    skin: '#f0c090', skinD: '#c48a5c', hair: '#18305c', pants: '#2a2a44', fx: '#7fe0ff', fxD: '#2f8fe0',
    pitch: 175, vowels: ['e', 'o', 'uh'] },
  { name: 'YAN', move: 'EMBER SHOT', body: '#d83a2e', dark: '#8c1f1a', light: '#ff7a5c', trim: '#ffd23f',
    skin: '#dca070', skinD: '#a86c44', hair: '#3a1408', pants: '#3a2622', fx: '#ffc04a', fxD: '#f0601e',
    pitch: 128, vowels: ['e', 'uh', 'a'] },
];
const OUT = '#120c1c';

/* ---------- Input ---------- */
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

/* ---------- Audio: chip-style synth, all generated at runtime ---------- */
let actx = null, noiseBuf = null, musicOn = true;
function initAudio() {
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (_) { actx = null; }
}
function tone(freq, dur, type = 'square', vol = 0.06, slide = 0, delay = 0) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.01);
  } catch (_) {}
}
function noise(dur, vol = 0.08, freq = 3000, delay = 0) {
  if (!actx || !noiseBuf) return;
  try {
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(), t = actx.currentTime + delay;
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(actx.destination); s.start(t); s.stop(t + dur + 0.01);
  } catch (_) {}
}
const VOWEL = { a: [800, 1250], e: [520, 1850], o: [460, 820], uh: [620, 1150] };
// Gritty formant "shout": three synthesized syllables, last one held.
function shout(ch) {
  if (!actx) return;
  try {
    const t0 = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    const f1 = actx.createBiquadFilter(), f2 = actx.createBiquadFilter();
    o.type = 'sawtooth'; f1.type = f2.type = 'bandpass'; f1.Q.value = 6; f2.Q.value = 9;
    g.gain.setValueAtTime(0.0001, t0);
    let t = t0;
    ch.vowels.forEach((v, i) => {
      const last = i === ch.vowels.length - 1, len = last ? 0.26 : 0.11;
      f1.frequency.setValueAtTime(VOWEL[v][0], t); f2.frequency.setValueAtTime(VOWEL[v][1], t);
      o.frequency.setValueAtTime(ch.pitch * (last ? 1.25 : 1 + i * 0.06), t);
      if (last) o.frequency.linearRampToValueAtTime(ch.pitch * 0.9, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.setValueAtTime(0.5, t + len * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + len);
      if (last) noise(0.06, 0.07, 2200, t - t0);
      t += len + 0.015;
    });
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t + 0.02);
  } catch (_) {}
}
const sfx = {
  swing: () => noise(0.07, 0.05, 1800),
  hit:   () => { noise(0.12, 0.16, 900); tone(140, 0.1, 'square', 0.08, -80); },
  block: () => { noise(0.04, 0.07, 4500); tone(520, 0.04, 'square', 0.04, -100); },
  fire:  () => { tone(220, 0.28, 'square', 0.05, 520, 0.3); noise(0.25, 0.05, 1200, 0.3); },
  ko:    () => { tone(330, 0.7, 'square', 0.08, -260); noise(0.5, 0.12, 500); },
  bell:  () => { tone(784, 0.1, 'square', 0.06); tone(1047, 0.25, 'square', 0.06, 0, 0.1); },
  ui:    () => tone(660, 0.05, 'square', 0.04),
  win:   () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.06, 0, i * 0.12)),
};

/* Original 4-bar loop: square lead, triangle bass, noise drums. */
const LEAD = [
  69,0,72,0,76,0,74,72, 0,69,0,0,67,0,69,0,
  65,0,69,0,72,0,77,76, 0,72,0,0,69,0,72,0,
  67,0,71,0,74,0,79,77, 0,74,0,71,0,74,0,0,
  76,0,0,74,0,71,0,67, 64,0,67,0,71,0,74,76,
];
const ROOTS = [45, 41, 43, 40];
const BASS = [0,-1,0,12,-1,0,12,-1, 0,-1,0,12,-1,0,7,12];
const mf = n => 440 * Math.pow(2, (n - 69) / 12);
let mStep = 0, mClock = 0;
function musicTick() {
  if (!actx || !musicOn) return;
  if (++mClock < 7) return;
  mClock = 0;
  const i = mStep % 64, s = i % 16, quiet = G.scene === 'menu' ? 0.6 : 1;
  if (LEAD[i]) tone(mf(LEAD[i]), 0.16, 'square', 0.028 * quiet);
  if (BASS[s] >= 0) tone(mf(ROOTS[i >> 4] + BASS[s]), 0.11, 'triangle', 0.09 * quiet);
  if (s === 0 || s === 6 || s === 8) tone(120, 0.08, 'triangle', 0.12 * quiet, -80);
  if (s === 4 || s === 12) noise(0.08, 0.05 * quiet, 1800);
  if (s % 2 === 0) noise(0.02, 0.018 * quiet, 7000);
  mStep++;
}

/* ---------- State ---------- */
const G = {
  scene: 'menu',      // menu | intro | fight | roundEnd | matchEnd
  mode: 'cpu', level: 1, paused: false,
  round: 1, timer: ROUND_TIME, frame: 0, tick: 0, sceneT: 0,
  shake: 0, hitstop: 0, banner: '', sub: '',
  fighters: [], shots: [], sparks: [], popups: [],
  ai: { plan: 'idle', t: 0, fresh: false },
  menuSel: 0,
};

function makeFighter(i) {
  return {
    i, ch: CHARS[i], x: i ? W - 280 : 280, y: GROUND, vx: 0, vy: 0, facing: i ? -1 : 1,
    hp: 100, shownHp: 100, energy: 0, state: 'idle', t: 0, hasHit: false,
    blocking: false, walk: 0, wins: 0, mD: -99, mDF: -99, mF: -99, combo: 0, comboT: 0,
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
  G.shots = []; G.sparks = []; G.popups = [];
  G.timer = ROUND_TIME; G.frame = 0; G.scene = 'intro'; G.sceneT = 0;
  G.ai = { plan: 'idle', t: 0, fresh: false };
}

/* ---------- CPU ---------- */
function aiInput(me, opp) {
  const inp = { left: false, right: false, up: false, down: false, punch: false, kick: false, special: false };
  const ai = G.ai, lv = G.level;
  const dist = Math.abs(opp.x - me.x);
  const toward = opp.x > me.x ? 'right' : 'left', away = opp.x > me.x ? 'left' : 'right';
  const react = [0.25, 0.55, 0.85][lv];

  const threat = G.shots.find(s => s.owner !== me && Math.abs(s.x - me.x) < 190 && Math.sign(s.vx) === Math.sign(me.x - s.x));
  if (threat && ai.plan !== 'dodge' && Math.random() < react * 0.3) {
    ai.plan = 'dodge'; ai.t = 28; ai.dodge = Math.random() < 0.5 ? 'jump' : (Math.random() < 0.5 ? 'crouch' : 'block'); ai.fresh = true;
  }
  if (ATK[opp.state] && opp.state !== 'special' && dist < 170 && ai.plan !== 'block' && ai.plan !== 'dodge' && Math.random() < react * 0.25) {
    ai.plan = 'block'; ai.t = 16; ai.fresh = true;
  }
  // Combo follow-up after a landed punch
  if (me.state === 'punch' && me.hasHit && Math.random() < react * 0.5) { inp.kick = true; return inp; }

  if (--ai.t <= 0) {
    const r = Math.random();
    ai.fresh = true;
    if (dist > 380) {
      if (me.energy >= ATK.special.cost && r < 0.3 + lv * 0.1) ai.plan = 'special';
      else if (r < 0.85) ai.plan = 'approach';
      else ai.plan = 'idle';
    } else if (dist > 150) {
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
    case 'jumpin':   inp[toward] = true; inp.up = ai.fresh; if (me.y < GROUND - 50 && dist < 150) inp.kick = Math.random() < 0.2; break;
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

/* ---------- Combat ---------- */
const grounded = f => f.y >= GROUND;
const crouching = f => f.state === 'crouch';

function spark(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
    G.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 12 + Math.random() * 10, color });
  }
}

function applyHit(v, atk, dir, dmg, kb, hx, hy) {
  if (v.state === 'ko') return;
  if (v.blocking) {
    v.hp -= dmg * 0.15; v.state = 'blockstun'; v.t = 11; v.vx = dir * kb * 0.7;
    spark(hx, hy, '#bfe0ff', 5); sfx.block();
    atk.energy = Math.min(100, atk.energy + 3);
  } else {
    atk.combo = v.state === 'hit' ? atk.combo + 1 : 1; atk.comboT = 70;
    v.hp -= dmg; v.state = 'hit'; v.t = 17; v.vx = dir * kb;
    if (!grounded(v)) v.vy = -5;
    spark(hx, hy, '#fff3a0', 12); G.sparks.push({ x: hx, y: hy, vx: 0, vy: 0, life: 6, color: '#ffffff', big: true });
    sfx.hit();
    G.shake = 8; G.hitstop = 5;
    atk.energy = Math.min(100, atk.energy + 9);
    v.energy = Math.min(100, v.energy + 5);
  }
  if (v.hp <= 0) {
    v.hp = 0; v.state = 'ko'; v.t = 0; v.vx = dir * 7; v.vy = -8; v.blocking = false;
    G.shake = 16; G.hitstop = 14; sfx.ko();
  }
}

function startAttack(f, name) {
  f.state = name; f.t = 0; f.hasHit = false;
  if (name === 'special') {
    f.energy -= ATK.special.cost; shout(f.ch); sfx.fire();
    G.popups.push({ text: f.ch.move + '!', x: f.x, y: f.y - 200, life: 50, color: f.ch.fx });
  } else sfx.swing();
}

function updateFighter(f, opp, inp) {
  f.energy = Math.min(100, f.energy + 0.04);
  if (f.comboT > 0 && --f.comboT === 0) f.combo = 0;
  const onGround = grounded(f);
  const free = f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'jump';

  // Motion buffer: down, down-forward, forward + punch
  const fwd = f.facing === 1 ? inp.right : inp.left;
  if (inp.down && !fwd) f.mD = G.tick;
  if (inp.down && fwd && G.tick - f.mD < 16) f.mDF = G.tick;
  if (fwd && !inp.down && G.tick - f.mDF < 12) f.mF = G.tick;
  const motion = inp.punch && G.tick - f.mF < 8;   // small leniency window after the motion
  const wantSpecial = (inp.special || motion) && f.energy >= ATK.special.cost;

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
        G.shots.push({ x: f.x + f.facing * 70, y: f.y - 112, vx: f.facing * 9, owner: f, life: 120, dmg: a.dmg });
      }
    } else {
      if (f.t >= a.startup && f.t < a.startup + a.active && !f.hasHit) {
        const dx = (opp.x - f.x) * f.facing;
        if (dx > -20 && dx < a.range && Math.abs(opp.y - f.y) < 105 && opp.state !== 'ko') {
          f.hasHit = true;
          const hy = f.state === 'punch' ? f.y - 122 : f.y - 84;
          applyHit(opp, f, f.facing, a.dmg, a.kb, (f.x + opp.x) / 2 + f.facing * 16, Math.min(hy, opp.y - 40));
        }
      }
      // Cancel a landed normal into the next move
      if (f.hasHit && onGround && f.state !== 'special') {
        if (wantSpecial) startAttack(f, 'special');
        else if (f.state === 'punch' && inp.kick) startAttack(f, 'kick');
      }
    }
    if (ATK[f.state] && f.t >= ATK[f.state].total) f.state = onGround ? 'idle' : 'jump';
  } else if (free) {
    if (onGround) {
      f.facing = opp.x >= f.x ? 1 : -1;
      const back = f.facing === 1 ? inp.left : inp.right;
      f.blocking = back;
      if (wantSpecial) { startAttack(f, 'special'); f.vx = 0; }
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

  if (grounded(f) && (f.state === 'hit' || f.state === 'blockstun' || f.state === 'ko')) f.vx *= 0.85;
  f.x += f.vx; f.vy += GRAV; f.y += f.vy;
  if (f.y >= GROUND) {
    f.y = GROUND; f.vy = 0;
    if (f.state === 'jump') { f.state = 'idle'; f.vx = 0; }
    else if (ATK[f.state]) f.vx = 0;
  }
  f.x = Math.max(EDGE, Math.min(W - EDGE, f.x));
  f.shownHp += (f.hp - f.shownHp) * 0.1;
}

function updateShots() {
  for (const s of G.shots) {
    s.x += s.vx; s.life--;
    if (s.x < -40 || s.x > W + 40) s.life = 0;
    for (const o of G.shots) {
      if (o !== s && o.owner !== s.owner && o.life > 0 && s.life > 0 && Math.abs(o.x - s.x) < 34) {
        spark((o.x + s.x) / 2, s.y, '#ffffff', 14); o.life = s.life = 0; sfx.block();
      }
    }
    const v = G.fighters[1 - s.owner.i];
    if (s.life > 0 && v.state !== 'ko') {
      const top = v.y - (crouching(v) ? 98 : 170);
      if (Math.abs(s.x - v.x) < 40 && s.y > top && s.y < v.y) {
        applyHit(v, s.owner, Math.sign(s.vx), s.dmg, 7, s.x, s.y); s.life = 0;
      }
    }
  }
  G.shots = G.shots.filter(s => s.life > 0);
}

function endRound(winner, banner) {
  G.scene = 'roundEnd'; G.sceneT = 0; G.banner = banner; G.sub = '';
  if (winner) { winner.wins++; if (winner.hp >= 100) G.sub = 'PERFECT'; }
  else G.sub = 'DRAW';
}

const NONE = { left: false, right: false, up: false, down: false, punch: false, kick: false, special: false };

function step() {
  if (pressed.has('KeyM')) musicOn = !musicOn;
  if (pressed.has('Escape') && G.scene !== 'menu') { G.paused = !G.paused; sfx.ui(); }
  pressed.delete('KeyM'); pressed.delete('Escape');
  if (G.paused) {
    if (pressed.has('KeyQ')) { G.paused = false; G.scene = 'menu'; }
    pressed.clear(); return;
  }
  musicTick();
  G.tick++;

  G.sparks.forEach(p => { p.x += p.vx; p.y += p.vy; if (!p.big) p.vy += 0.35; p.life--; });
  G.sparks = G.sparks.filter(p => p.life > 0);
  G.popups.forEach(p => { p.y -= 0.6; p.life--; });
  G.popups = G.popups.filter(p => p.life > 0);
  if (G.shake > 0) G.shake--;

  if (G.scene === 'menu') {
    const ok = pressed.has('Enter') || pressed.has('Space');
    if (pressed.has('ArrowUp') || pressed.has('KeyW')) { G.menuSel = (G.menuSel + 2) % 3; sfx.ui(); }
    if (pressed.has('ArrowDown') || pressed.has('KeyS')) { G.menuSel = (G.menuSel + 1) % 3; sfx.ui(); }
    if (G.menuSel === 2) {
      if (pressed.has('ArrowLeft') || pressed.has('KeyA')) { G.level = (G.level + 2) % 3; sfx.ui(); }
      if (pressed.has('ArrowRight') || pressed.has('KeyD') || ok) { G.level = (G.level + 1) % 3; sfx.ui(); }
    } else if (ok) { sfx.bell(); startMatch(G.menuSel === 0 ? 'cpu' : 'pvp'); }
    pressed.clear(); return;
  }

  if (G.hitstop > 0) { G.hitstop--; return; }   // keep buffered presses so cancels come out
  const [a, b] = G.fighters;
  G.sceneT++;

  if (G.scene === 'intro') {
    updateFighter(a, b, NONE); updateFighter(b, a, NONE);
    if (G.sceneT === 70) sfx.bell();
    if (G.sceneT > 110) { G.scene = 'fight'; G.sceneT = 0; }
  } else if (G.scene === 'fight') {
    const ia = readInput(0), ib = G.mode === 'pvp' ? readInput(1) : aiInput(b, a);
    updateFighter(a, b, ia); updateFighter(b, a, ib);
    if (grounded(a) && grounded(b) && Math.abs(a.x - b.x) < 64) {
      const push = (64 - Math.abs(a.x - b.x)) / 2, d = a.x <= b.x ? -1 : 1;
      a.x = Math.max(EDGE, Math.min(W - EDGE, a.x + d * push));
      b.x = Math.max(EDGE, Math.min(W - EDGE, b.x - d * push));
    }
    updateShots();
    G.frame++;
    if (G.frame % 60 === 0 && G.timer > 0) G.timer--;
    if (a.hp <= 0 || b.hp <= 0) endRound(a.hp <= 0 && b.hp <= 0 ? null : a.hp > 0 ? a : b, 'K.O.');
    else if (G.timer <= 0) { endRound(a.hp === b.hp ? null : a.hp > b.hp ? a : b, 'TIME UP'); G.sub = G.sub === 'PERFECT' ? '' : G.sub; sfx.bell(); }
  } else if (G.scene === 'roundEnd') {
    updateFighter(a, b, NONE); updateFighter(b, a, NONE); updateShots();
    if (G.sceneT > 170) {
      if (a.wins >= WINS_NEEDED || b.wins >= WINS_NEEDED) { G.scene = 'matchEnd'; G.sceneT = 0; sfx.win(); }
      else { G.round++; startRound(); }
    }
  } else if (G.scene === 'matchEnd') {
    updateFighter(a, b, NONE); updateFighter(b, a, NONE);
    if (G.sceneT > 40 && (pressed.has('Enter') || pressed.has('Space'))) { G.scene = 'menu'; sfx.ui(); }
  }
  pressed.clear();
}

/* ---------- Pixel rendering ---------- */
const px = v => Math.round(v * S);
function R(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }

function seg(p, q, w, c) {
  const dx = q[0] - p[0], dy = q[1] - p[1], n = Math.max(Math.abs(dx), Math.abs(dy), 1), o = w >> 1;
  ctx.fillStyle = c;
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(p[0] + dx * i / n) - o, Math.round(p[1] + dy * i / n) - o, w, w);
}
function disc(cx, cy, r, c, y0 = -r, y1 = r) {
  ctx.fillStyle = c;
  for (let dy = y0; dy <= y1; dy++) { const h = Math.round(Math.sqrt(r * r - dy * dy)); ctx.fillRect(cx - h, cy + dy, h * 2 + 1, 1); }
}

/* 3x5 bitmap font */
const FONT = {
  A:'010101111101101',B:'110101110101110',C:'011100100100011',D:'110101101101110',E:'111100110100111',
  F:'111100110100100',G:'011100101101011',H:'101101111101101',I:'111010010010111',J:'001001001101010',
  K:'101101110101101',L:'100100100100111',M:'1000111011101011000110001',N:'10011101101110011001',O:'010101101101010',
  P:'110101110100100',Q:'010101101110011',R:'110101110101101',S:'011100010001110',T:'111010010010010',
  U:'101101101101111',V:'101101101101010',W:'1000110001101011101110001',X:'101101010101101',Y:'101101010010010',
  Z:'111001010100111',
  0:'111101101101111',1:'010110010010111',2:'110001010100111',3:'110001010001110',4:'101101111001001',
  5:'111100110001110',6:'011100111101111',7:'111001010010010',8:'111101111101111',9:'111101111001110',
  '.':'000000000000010','!':'010010010000010','-':'000000111000000','/':'001001010100100',
  ':':'000010000010000',',':'000000000010100','+':'000010111010000','>':'100010001010100','<':'001010100010001',
};
const gw = chr => FONT[chr] ? FONT[chr].length / 5 : 3;
const textW = (s, sc) => { let w = 0; for (const chr of s) w += (gw(chr) + 1) * sc; return w - sc; };
function glyphs(str, x, y, sc, color) {
  for (const chr of str) {
    const g = FONT[chr], w = gw(chr);
    if (g) for (let i = 0; i < g.length; i++) if (g[i] === '1') {
      ctx.fillStyle = Array.isArray(color) ? color[(i / w) | 0] : color;
      ctx.fillRect(x + (i % w) * sc, y + ((i / w) | 0) * sc, sc, sc);
    }
    x += (w + 1) * sc;
  }
}
function txt(str, x, y, sc = 1, color = '#fff', align = 'center', shadow = OUT) {
  str = String(str);
  const w = textW(str, sc);
  x = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  if (shadow) { glyphs(str, x + sc, y + sc, sc, shadow); if (sc > 1) glyphs(str, x - 1, y, sc, shadow), glyphs(str, x, y - 1, sc, shadow); }
  glyphs(str, x, y, sc, color);
}

const SKY = ['#1a1140', '#2a1652', '#43205f', '#632a66', '#8a3666', '#b5485c', '#d96a4e', '#f09a4a'];
const HORIZON = 172;
const skyline = Array.from({ length: 24 }, (_, i) => ({
  x: i * 16 - 4, w: 13 + (i * 37 % 8), h: 26 + (i * 53 % 62),
  win: Array.from({ length: 40 }, (_, k) => ((i * 7 + k * 13) % 5) < 2),
}));

function drawStage() {
  const bh = Math.ceil(HORIZON / SKY.length);
  SKY.forEach((c, i) => {
    R(0, i * bh, SW, bh, c);
    if (i) { ctx.fillStyle = c; for (let x = (i % 2); x < SW; x += 2) ctx.fillRect(x, i * bh - 1, 1, 1); }
  });
  // sun
  for (let dy = -34; dy <= 34; dy++) {
    if (dy > 6 && (dy % 6 === 0 || dy % 6 === 1 && dy > 18)) continue;
    const h = Math.round(Math.sqrt(34 * 34 - dy * dy));
    R(276 - h, 132 + dy, h * 2 + 1, 1, dy < -12 ? '#fff0b0' : dy < 8 ? '#ffd88a' : '#ffb870');
  }
  // skyline
  for (const b of skyline) {
    const top = HORIZON - 8 - b.h;
    R(b.x, top, b.w, b.h + 8, '#1c1432'); R(b.x, top, 1, b.h + 8, '#2b2148');
    b.win.forEach((on, k) => {
      const wx = b.x + 2 + (k % 4) * 4, wy = top + 4 + ((k / 4) | 0) * 6;
      if (on && wx < b.x + b.w - 2 && wy < HORIZON - 12) R(wx, wy, 2, 3, k % 7 === 0 ? '#ffe9a8' : '#e0a050');
    });
  }
  R(0, HORIZON - 8, SW, 8, '#241a3a'); for (let x = 0; x < SW; x += 12) R(x, HORIZON - 8, 1, 8, '#171026');
  // street
  R(0, HORIZON, SW, SH - HORIZON, '#3b3352'); R(0, HORIZON, SW, 1, '#6a5f86');
  for (let i = 0, y = HORIZON + 4, g = 3; y < SH; i++, y += g, g += 2) R(0, y, SW, 1, '#2c2640');
  for (let i = -8; i <= 8; i++) {
    const x0 = SW / 2 + i * 26, x1 = SW / 2 + i * 60;
    seg([Math.round(x0), HORIZON + 1], [Math.round(x1), SH], 1, '#2c2640');
  }
}

function drawFighter(f) {
  const c = f.ch, st = f.state;
  const flash = st === 'hit' && f.t > 13;
  const col = k => flash ? '#ffffff' : k;

  const sw = px(70 - Math.min(34, (GROUND - f.y) / 5));
  R(px(f.x) - (sw >> 1), px(GROUND) + 2, sw, 2, '#191326'); R(px(f.x) - (sw >> 1) + 2, px(GROUND) + 4, sw - 4, 1, '#191326');

  const crouch = st === 'crouch';
  const bob = st === 'idle' && Math.sin(G.tick * 0.13 + f.i * 2) > 0 ? 2 : 0;
  const hipY = crouch ? -36 : -58, shY = (crouch ? -72 : -106) + bob;
  let lean = 0, ext = 0;
  if (ATK[st]) {
    const a = ATK[st], rec = a.startup + 6;
    ext = Math.sin(Math.min(1, f.t / (a.startup + 4)) * Math.PI * 0.5) * (f.t > rec ? Math.max(0, 1 - (f.t - rec) / (a.total - rec)) : 1);
  }
  if (st === 'hit') lean = -0.3;
  if (st === 'blockstun') lean = -0.1;
  if (st === 'ko') lean = -Math.PI / 2 * Math.min(1, f.t / 18);
  if (st === 'punch' || st === 'special') lean = 0.12 * ext;
  if (st === 'kick') lean = -0.25 * ext;
  const oy = st === 'ko' && grounded(f) ? -10 : 0;
  const cs = Math.cos(lean), sn = Math.sin(lean);
  const P = (lx, ly) => {
    const rx = lx * cs - ly * sn, ry = lx * sn + ly * cs;
    return [Math.round((f.x + f.facing * rx * SPR) * S), Math.round((f.y + (ry + oy) * SPR) * S)];
  };
  const limb = (a, b, bend, w, color, shade) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const j = [(a[0] + b[0]) / 2 - dy / len * bend, (a[1] + b[1]) / 2 + dx / len * bend];
    const pa = P(a[0], a[1]), pj = P(j[0], j[1]), pb = P(b[0], b[1]);
    seg(pa, pj, w + 2, OUT); seg(pj, pb, w + 2, OUT);
    seg(pa, pj, w, col(color)); seg(pj, pb, w, col(shade || color));
    return pb;
  };

  // legs
  let f1 = [16, 0], f2 = [-16, 0];
  if (st === 'walk') { const s = Math.sin(f.walk) * 16; f1 = [14 + s, -Math.max(0, -Math.sin(f.walk + 1.5)) * 8]; f2 = [-14 - s, -Math.max(0, Math.sin(f.walk + 1.5)) * 8]; }
  if (!grounded(f) && st !== 'ko' && st !== 'kick') { f1 = [14, -22]; f2 = [-10, -12]; }
  if (crouch) { f1 = [22, 0]; f2 = [-20, 0]; }
  if (st === 'kick') { f1 = [20 + 84 * ext, -66 * ext]; f2 = [-12, grounded(f) ? 0 : -14]; }

  // arms
  let h1 = [26, shY + 22], h2 = [12, shY + 30];
  if (f.blocking && st !== 'hit') { h1 = [22, shY - 6]; h2 = [18, shY + 8]; }
  if (st === 'punch') { h1 = [24 + 60 * ext, shY + 6]; h2 = [6, shY + 26]; }
  if (st === 'special') { h1 = [20 + 44 * ext, shY + 18]; h2 = [16 + 44 * ext, shY + 30]; }
  if (st === 'hit' || st === 'ko') { h1 = [18, shY - 16]; h2 = [-16, shY - 6]; }
  if (st === 'kick') { h1 = [10, shY + 22]; h2 = [-18, shY + 12]; }

  const shoe = p => { R(p[0] - 3, p[1] - 3, 7, 4, OUT); R(p[0] - 2 + (f.facing > 0 ? 1 : -1), p[1] - 2, 5, 2, col(c.trim)); };
  const fist = (p, k) => { R(p[0] - 3, p[1] - 3, 7, 7, OUT); R(p[0] - 2, p[1] - 2, 5, 5, col(k)); R(p[0] - 2, p[1] - 2, 5, 1, col('#ffffff')); };

  // back leg + back arm
  shoe(limb([-5, hipY], f2, crouch ? -14 : -6, 5, '#1c1c2c'));
  fist(limb([-4, shY + 6], h2, 8, 3, c.skinD), c.dark);
  // torso
  const hip = P(0, hipY), sh = P(0, shY + 6);
  seg(hip, sh, 15, OUT); seg(hip, sh, 13, col(c.body));
  seg([hip[0] - f.facing * 4, hip[1]], [sh[0] - f.facing * 4, sh[1]], 5, col(c.dark));
  seg([hip[0] + f.facing * 4, hip[1] - 2], [sh[0] + f.facing * 4, sh[1]], 2, col(c.light));
  R(hip[0] - 7, hip[1] - 1, 14, 3, col(c.trim)); R(hip[0] - 7, hip[1] + 2, 14, 1, OUT);
  // head
  const hd = P(3, shY - 20), r = 7, fx = f.facing;
  disc(hd[0], hd[1], r + 1, OUT);
  disc(hd[0], hd[1], r, col(c.skin));
  disc(hd[0], hd[1], r, col(c.hair), -r, -3);
  R(hd[0] - fx * 7 - 1, hd[1] - 3, 4, 5, col(c.hair));
  if (f.i === 0) {           // LAN: knit beanie, pom-pom, long scarf
    disc(hd[0], hd[1], r, col(c.light), -r, -4);
    R(hd[0] - 7, hd[1] - 4, 15, 2, col(c.trim));
    R(hd[0] - 2, hd[1] - r - 4, 5, 5, OUT); R(hd[0] - 1, hd[1] - r - 3, 3, 3, col(c.trim));
    const nk = P(1, shY - 4), fl = Math.sin(G.tick * 0.2) > 0 ? 1 : 0;
    R(nk[0] - 6, nk[1] - 2, 12, 4, OUT); R(nk[0] - 5, nk[1] - 1, 10, 2, col(c.trim));
    seg([nk[0] - fx * 5, nk[1]], [nk[0] - fx * 10, nk[1] + 4 + fl], 3, col(c.trim));
    seg([nk[0] - fx * 10, nk[1] + 4 + fl], [nk[0] - fx * 12, nk[1] + 10 - fl], 3, col(c.light));
  } else {                   // YAN: spiked hair, visor shades
    for (let k = -1; k <= 1; k++) { R(hd[0] + k * 4 - 1, hd[1] - r - 3, 3, 4, OUT); R(hd[0] + k * 4, hd[1] - r - 2, 1, 3, col(c.hair)); }
    if (!flash) R(hd[0] + (fx > 0 ? 0 : -7), hd[1] - 2, 8, 3, c.trim);
  }
  if (!flash) {
    R(hd[0] + fx * 3 - (fx < 0 ? 1 : 0), hd[1] - 1, 2, st === 'hit' || st === 'ko' ? 1 : 2, OUT);
    R(hd[0] + fx * 2 - (fx < 0 ? 2 : 0), hd[1] + 3, 3, 1, c.skinD);
  }
  // front leg + front arm
  shoe(limb([5, hipY], f1, st === 'kick' ? -4 * (1 - ext) : (crouch ? 16 : 7), 5, c.pants));
  const hand = limb([4, shY + 6], h1, st === 'punch' ? -6 * (1 - ext) : -9, 3, c.skin);
  fist(hand, c.trim);
  // charge glow
  if (st === 'special' && f.t < ATK.special.startup) {
    const g = P(46, shY + 24), rr = 2 + (f.t >> 1);
    disc(g[0], g[1], rr, c.fxD); disc(g[0], g[1], Math.max(1, rr - 2), f.t % 4 < 2 ? '#ffffff' : c.fx);
  }
}

function drawShot(s) {
  const c = s.owner.ch, x = px(s.x), y = px(s.y), d = Math.sign(s.vx), fl = G.tick % 4 < 2;
  if (s.owner.i === 0) {     // LAN: stacked wind crescents
    for (let k = 2; k >= 0; k--) {
      const r = 9 - k * 2, ox = x - d * k * 7, c2 = k === 0 ? '#ffffff' : k === 1 ? c.fx : c.fxD;
      for (let dy = -r; dy <= r; dy++) {
        const h = Math.round(Math.sqrt(r * r - dy * dy)), t = k === 0 ? 3 : 2;
        if (k === 0) R(ox + (d > 0 ? h - t - 1 : -h - 1), y + dy, t + 2, 1, c.fxD);
        R(ox + (d > 0 ? h - t : -h), y + dy, t, 1, fl && k ? c.fx : c2);
      }
    }
  } else {                   // YAN: spinning ember shard with sparks
    for (let i = 1; i <= 4; i++) R(x - d * i * 5 - 1, y + ((G.tick * 3 + i * 5) % 9) - 4, 2, 2, i % 2 ? c.fx : c.fxD);
    for (let dy = -8; dy <= 8; dy++) R(x - (8 - Math.abs(dy)), y + dy, (8 - Math.abs(dy)) * 2 + 1, 1, OUT);
    for (let dy = -6; dy <= 6; dy++) R(x - (6 - Math.abs(dy)), y + dy, (6 - Math.abs(dy)) * 2 + 1, 1, fl ? c.fxD : c.fx);
    for (let dy = -3; dy <= 3; dy++) R(x - (3 - Math.abs(dy)), y + dy, (3 - Math.abs(dy)) * 2 + 1, 1, fl ? c.fx : '#ffffff');
  }
}

function drawHUD() {
  const [a, b] = G.fighters, bw = 152, bh = 8, y = 14;
  [[a, 16, 1], [b, SW - 16 - bw, -1]].forEach(([f, x, d]) => {
    R(x - 2, y - 2, bw + 4, bh + 4, OUT); R(x - 1, y - 1, bw + 2, bh + 2, '#f4f0ff');
    R(x, y, bw, bh, '#7a1420');
    const wS = Math.round(bw * f.shownHp / 100), wH = Math.round(bw * f.hp / 100);
    R(d === 1 ? x + bw - wS : x, y, wS, bh, '#ff4a3a');
    R(d === 1 ? x + bw - wH : x, y, wH, bh, '#ffd23f'); R(d === 1 ? x + bw - wH : x, y, wH, 2, '#fff3a0');
    const ew = 70, ex = d === 1 ? x : x + bw - ew, we = Math.round(ew * f.energy / 100), ready = f.energy >= ATK.special.cost;
    R(ex - 1, y + bh + 4, ew + 2, 5, OUT);
    R(d === 1 ? ex : ex + ew - we, y + bh + 5, we, 3, ready ? (G.tick % 20 < 10 ? f.ch.fx : '#ffffff') : '#6a6880');
    const tag = f.i === 0 ? 'P1' : G.mode === 'cpu' ? 'CPU' : 'P2';
    txt(f.ch.name, d === 1 ? x : x + bw, 4, 1, f.ch.light, d === 1 ? 'left' : 'right');
    txt(tag, d === 1 ? x + 16 : x + bw - 16, 4, 1, '#c8c0e0', d === 1 ? 'left' : 'right');
    for (let i = 0; i < WINS_NEEDED; i++) {
      const wx = d === 1 ? x + bw - 6 - i * 8 : x + 1 + i * 8;
      R(wx - 1, y + bh + 3, 7, 7, OUT); R(wx, y + bh + 4, 5, 5, i < f.wins ? '#ffd23f' : '#3a3352');
    }
    if (f.combo >= 2) txt(f.combo + ' HITS', d === 1 ? 20 : SW - 20, 52, 2, '#ffd23f', d === 1 ? 'left' : 'right');
  });
  R(SW / 2 - 14, 8, 28, 20, OUT); R(SW / 2 - 13, 9, 26, 18, '#2a2244');
  txt(String(G.timer).padStart(2, '0'), SW / 2 + 1, 11, 3, G.timer <= 10 ? '#ff5a3c' : '#ffffff', 'center', null);
}

const TITLE_COL = ['#fff6b8', '#ffe066', '#ffd23f', '#f59a2b', '#e0601e'];
function drawMenu() {
  drawStage();
  ctx.fillStyle = 'rgba(10,6,22,.6)'; ctx.fillRect(0, 0, SW, SH);
  glyphs('STREEFIGHT', SW / 2 - textW('STREEFIGHT', 8) / 2 + 3, 25, 8, '#7a1420');
  glyphs('STREEFIGHT', SW / 2 - textW('STREEFIGHT', 8) / 2, 22, 8, TITLE_COL);
  txt('- ARCADE BRAWLER -', SW / 2, 70, 1, '#ffb38a');
  const items = ['1P VS CPU', '2P VERSUS', 'CPU LEVEL: ' + ['EASY', 'NORMAL', 'HARD'][G.level]];
  items.forEach((s, i) => {
    const sel = i === G.menuSel, y = 90 + i * 18;
    if (sel) { R(SW / 2 - 78, y - 4, 156, 18, '#3a2a10'); R(SW / 2 - 78, y - 4, 156, 1, '#ffd23f'); R(SW / 2 - 78, y + 13, 156, 1, '#ffd23f'); if (G.tick % 30 < 20) txt('>', SW / 2 - 70, y, 2, '#ffd23f', 'left'); }
    txt(s, SW / 2, y, 2, sel ? '#ffffff' : '#9a92b4');
  });
  if (G.tick % 60 < 40) txt('PRESS ENTER', SW / 2, 150, 1, '#ffffff');
  txt('P1: A/D MOVE  W JUMP  S CROUCH  J PUNCH  K KICK  L SPECIAL', SW / 2, 166, 1, '#9fd0ff');
  txt('P2: ARROWS MOVE   , PUNCH   . KICK   / SPECIAL', SW / 2, 176, 1, '#ffb0a0');
  txt('HOLD BACK: BLOCK    DOWN, DOWN+FWD, FWD + PUNCH: SPECIAL', SW / 2, 188, 1, '#e8e0ff');
  txt('PUNCH > KICK > SPECIAL: COMBO     M: MUSIC   F11: FULLSCREEN', SW / 2, 198, 1, '#a8a0c0');
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (G.scene === 'menu') { drawMenu(); return; }
  if (G.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * G.shake * 0.5), Math.round((Math.random() - 0.5) * G.shake * 0.5));
  drawStage();
  G.fighters.slice().sort((p, q) => (ATK[p.state] ? 1 : 0) - (ATK[q.state] ? 1 : 0)).forEach(drawFighter);
  G.shots.forEach(drawShot);
  for (const p of G.sparks) {
    const x = px(p.x), y = px(p.y);
    if (p.big) { const r = 2 + (6 - p.life) * 2; R(x - r, y - 1, r * 2, 2, p.color); R(x - 1, y - r, 2, r * 2, p.color); }
    else R(x - 1, y - 1, p.life > 8 ? 3 : 2, p.life > 8 ? 3 : 2, p.life % 4 < 2 ? p.color : '#ffffff');
  }
  for (const p of G.popups) if (p.life > 12 || p.life % 4 < 2) txt(p.text, Math.max(50, Math.min(SW - 50, px(p.x))), px(p.y), 1, p.color);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHUD();

  if (G.scene === 'intro') {
    if (G.sceneT < 70) txt('ROUND ' + G.round, SW / 2, 72, 6, '#ffffff');
    else if (G.sceneT % 6 < 4) txt('FIGHT!', SW / 2, 66, 8, TITLE_COL);
  } else if (G.scene === 'roundEnd') {
    txt(G.banner, SW / 2, 62, 8, '#ff5a3c');
    if (G.sub && G.sceneT > 40) txt(G.sub, SW / 2, 112, 3, '#ffd23f');
  } else if (G.scene === 'matchEnd') {
    const [a, b] = G.fighters, w = a.wins > b.wins ? a : b;
    R(0, 58, SW, 78, OUT); R(0, 59, SW, 1, w.ch.fx); R(0, 134, SW, 1, w.ch.fx);
    txt(w.ch.name + ' WINS', SW / 2, 68, 6, w.ch.fx);
    txt(G.mode === 'cpu' ? (w.i === 0 ? 'YOU WIN!' : 'YOU LOSE') : 'PLAYER ' + (w.i + 1) + ' WINS', SW / 2, 106, 2, '#ffffff');
    if (G.sceneT > 40 && G.tick % 60 < 40) txt('PRESS ENTER', SW / 2, 124, 1, '#c8c0e0');
  }
  if (G.paused) {
    ctx.fillStyle = 'rgba(8,4,18,.7)'; ctx.fillRect(0, 0, SW, SH);
    txt('PAUSED', SW / 2, 78, 6, '#ffffff');
    txt('ESC: RESUME    Q: QUIT TO MENU', SW / 2, 124, 1, '#c8c0e0');
  }
}

/* ---------- Main loop (fixed 60 Hz) ---------- */
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
