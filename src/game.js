/* StreeFight - original retro-style 2D fighter. Pure Canvas + WebAudio, no assets. */
(() => {
'use strict';

/* World units are 960x540, drawn as vector art onto a 1920x1080 buffer. */
const W = 960, H = 540, GROUND = 452, GRAV = 0.7, WALK = 4.2, JUMP = -15.5;
const SPR = 1.4, EDGE = 56;
const ROUND_TIME = 60, WINS_NEEDED = 2;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// Frame data: startup / active / total
const ATK = {
  punch:   { startup: 5,  active: 4, total: 17, dmg: 6,  range: 110, kb: 5 },
  kick:    { startup: 8,  active: 5, total: 27, dmg: 10, range: 142, kb: 7 },
  special: { startup: 14, active: 0, total: 36, dmg: 14, cost: 35 },
};

const CHARS = [
  { name: 'LAN', move: 'AERO BURST', body: '#2f6fe0', dark: '#1d469c', light: '#7db4ff', trim: '#f2f6ff', trimD: '#b4c2e4',
    skin: '#f2c79c', skinD: '#cf9668', hair: '#1b2a4a', pants: '#333a68', pantsD: '#20244a', shoe: '#f2f6ff', sole: '#2f6fe0',
    fx: '#7fe0ff', fxD: '#2f8fe0',
    pitch: 175, vowels: ['e', 'o', 'uh'] },
  { name: 'YAN', move: 'EMBER SHOT', body: '#d63a2c', dark: '#96211c', light: '#ff8466', trim: '#ffcc33', trimD: '#d0941a',
    skin: '#e0a674', skinD: '#b57848', hair: '#40170a', pants: '#54342a', pantsD: '#352019', shoe: '#3a2018', sole: '#ffcc33',
    fx: '#ffc04a', fxD: '#f0601e',
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
    G.popups.push({ text: f.ch.move + '!', x: f.x, y: f.y - 215, life: 50, color: f.ch.fx });
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

/* ---------- Rendering: vector art in 960x540 world units on a 1920x1080 buffer ---------- */
const RS = canvas.width / W, TAU = Math.PI * 2;
const rnd = i => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const fontOf = (n, small) => small
  ? `700 ${n}px "Trebuchet MS", "Segoe UI", Verdana, sans-serif`
  : `italic 900 ${n}px Impact, "Arial Black", "Segoe UI Black", sans-serif`;

function txt(str, x, y, size, color = '#fff', align = 'center', small = false) {
  ctx.font = fontOf(size, small); ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  let fill = color;
  if (color === 'gold' || color === 'red') {
    fill = ctx.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.45);
    const st = color === 'gold' ? ['#fffbd0', '#ffd23f', '#f07a1e'] : ['#ffd0a0', '#ff5a3c', '#a8141e'];
    fill.addColorStop(0, st[0]); fill.addColorStop(0.5, st[1]); fill.addColorStop(1, st[2]);
  }
  const lw = small ? Math.max(2.5, size / 5) : Math.max(3, size / 6);
  ctx.lineWidth = lw; ctx.strokeStyle = OUT;
  if (!small) { ctx.fillStyle = 'rgba(10,4,20,.55)'; ctx.fillText(str, x + size / 12, y + size / 9); ctx.strokeText(str, x + size / 12, y + size / 9); }
  ctx.strokeText(str, x, y); ctx.fillStyle = fill; ctx.fillText(str, x, y);
}

/* ----- Stage (painted once to an offscreen buffer) ----- */
const HZ = GROUND - 22;
function paintStage(c) {
  let g = c.createLinearGradient(0, 0, 0, HZ);
  [[0, '#120b34'], [0.35, '#3a1a5c'], [0.62, '#8a3068'], [0.86, '#e2643f'], [1, '#ffb44e']].forEach(s => g.addColorStop(s[0], s[1]));
  c.fillStyle = g; c.fillRect(0, 0, W, HZ);
  for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(255,255,255,${0.25 + rnd(i) * 0.6})`; const r = 0.6 + rnd(i + 9) * 1.1; c.fillRect(rnd(i + 1) * W, rnd(i + 2) * 190, r, r); }
  // sun + haze
  g = c.createRadialGradient(690, 340, 20, 690, 340, 260);
  g.addColorStop(0, 'rgba(255,220,150,.75)'); g.addColorStop(1, 'rgba(255,160,90,0)');
  c.fillStyle = g; c.fillRect(380, 80, 620, 400);
  g = c.createLinearGradient(0, 250, 0, 430); g.addColorStop(0, '#fff6c0'); g.addColorStop(1, '#ff9a4a');
  c.fillStyle = g; c.beginPath(); c.arc(690, 340, 92, 0, TAU); c.fill();
  // cloud bands
  for (let i = 0; i < 9; i++) {
    c.fillStyle = `rgba(${150 + i * 8},${60 + i * 6},110,${0.28 + rnd(i + 40) * 0.2})`;
    c.beginPath(); c.ellipse(rnd(i + 20) * W, 150 + i * 26 + rnd(i + 3) * 14, 90 + rnd(i + 30) * 160, 5 + rnd(i + 50) * 7, 0, 0, TAU); c.fill();
  }
  // far skyline
  for (let i = 0, x = -10; x < W; i++) {
    const w = 34 + rnd(i + 60) * 46, h = 70 + rnd(i + 70) * 150;
    c.fillStyle = '#5a2a68'; c.fillRect(x, HZ - h, w, h);
    c.fillStyle = 'rgba(255,190,120,.35)';
    for (let k = 0; k < 14; k++) if (rnd(i * 31 + k) < 0.4) c.fillRect(x + 5 + (k % 3) * (w / 3.4), HZ - h + 10 + ((k / 3) | 0) * 22, 3, 5);
    x += w + rnd(i + 80) * 10;
  }
  // near skyline
  for (let i = 0, x = -20; x < W; i++) {
    const w = 52 + rnd(i + 100) * 64, h = 90 + rnd(i + 110) * 210, top = HZ - h;
    g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#2a1b46'); g.addColorStop(0.18, '#1c1232'); g.addColorStop(1, '#150d28');
    c.fillStyle = g; c.fillRect(x, top, w, h);
    c.fillStyle = '#3a2760'; c.fillRect(x, top, w, 3);
    if (rnd(i + 120) < 0.5) { c.fillStyle = '#1c1232'; c.fillRect(x + w * 0.3, top - 16, 3, 16); c.fillRect(x + w * 0.6, top - 9, 14, 9); }
    const cols = Math.floor((w - 12) / 11), rows = Math.floor((h - 34) / 17);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const v = rnd(i * 97 + r * 13 + k * 7);
      if (v < 0.42) { c.fillStyle = v < 0.07 ? '#9fe0ff' : v < 0.25 ? '#ffd27a' : '#e09a4a'; c.fillRect(x + 8 + k * 11, top + 14 + r * 17, 6, 9); }
      else { c.fillStyle = '#241840'; c.fillRect(x + 8 + k * 11, top + 14 + r * 17, 6, 9); }
    }
    x += w + 4 + rnd(i + 130) * 22;
  }
  // neon signs
  [[150, 250, 'ARCADE', '#ff4fa8'], [470, 300, 'HOTEL', '#4fe0ff'], [820, 270, '24H', '#ffe14f']].forEach(([x, y, s, col]) => {
    c.font = fontOf(22); c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = (c.measureText(s) || {}).width || s.length * 13;
    c.fillStyle = '#100a1e'; c.fillRect(x - w / 2 - 9, y - 16, w + 18, 32);
    c.shadowColor = col; c.shadowBlur = 14; c.strokeStyle = col; c.lineWidth = 2; c.strokeRect(x - w / 2 - 9, y - 16, w + 18, 32);
    c.fillStyle = col; c.fillText(s, x, y + 1); c.shadowBlur = 0;
  });
  // railing
  c.fillStyle = '#120b20'; c.fillRect(0, HZ - 30, W, 4); c.fillRect(0, HZ - 16, W, 3);
  for (let x = 0; x < W; x += 24) c.fillRect(x, HZ - 30, 3, 30);
  // street
  g = c.createLinearGradient(0, HZ, 0, H); g.addColorStop(0, '#54486e'); g.addColorStop(0.25, '#3a3152'); g.addColorStop(1, '#17121f');
  c.fillStyle = g; c.fillRect(0, HZ, W, H - HZ);
  g = c.createLinearGradient(0, HZ, 0, H); g.addColorStop(0, 'rgba(255,180,100,.4)'); g.addColorStop(1, 'rgba(255,180,100,0)');
  c.fillStyle = g; c.beginPath(); c.moveTo(620, HZ); c.lineTo(760, HZ); c.lineTo(900, H); c.lineTo(480, H); c.fill();
  c.strokeStyle = 'rgba(12,8,22,.5)'; c.lineWidth = 1.5;
  for (let i = -14; i <= 14; i++) { c.beginPath(); c.moveTo(W / 2 + i * 62, HZ); c.lineTo(W / 2 + i * 150, H); c.stroke(); }
  for (let y = HZ + 8, s = 8; y < H; y += s, s *= 1.5) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.fillStyle = '#8073a0'; c.fillRect(0, HZ, W, 2.5);
  // street lamps
  [90, 870].forEach((x, i) => {
    const d = i ? -1 : 1;
    c.fillStyle = '#0e0918'; c.fillRect(x - 4, 150, 8, HZ - 144); c.fillRect(x - 9, HZ - 8, 18, 12);
    c.fillRect(d > 0 ? x : x - 46, 150, 46, 6);
    g = c.createRadialGradient(x + d * 44, 166, 2, x + d * 44, 166, 70);
    g.addColorStop(0, 'rgba(255,240,190,.9)'); g.addColorStop(0.2, 'rgba(255,210,130,.35)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    c.fillStyle = g; c.fillRect(x + d * 44 - 70, 96, 140, 140);
    c.fillStyle = '#fff6d0'; c.beginPath(); c.ellipse(x + d * 44, 162, 11, 6, 0, 0, TAU); c.fill();
  });
}
let stageCv = null, stageTried = false;
function drawStage() {
  if (!stageTried) {
    stageTried = true;
    try {
      const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = canvas.height;
      const c = cv.getContext('2d'); c.scale(RS, RS); paintStage(c); stageCv = cv;
    } catch (_) { stageCv = null; }
  }
  if (stageCv) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(stageCv, 0, 0); ctx.restore(); }
  else paintStage(ctx);
}

/* ----- Fighter rig ----- */
function ik(a, b, l1, l2, dir) {
  let dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 0.001;
  const max = l1 + l2;
  if (d > max) { const s = Math.min(1.14, d / max); l1 *= s; l2 *= s; if (d > l1 + l2) { const k = (l1 + l2) / d; dx *= k; dy *= k; d = l1 + l2; } }
  const a1 = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const ang = Math.atan2(dy, dx) + dir * a1;
  return [[a[0] + Math.cos(ang) * l1, a[1] + Math.sin(ang) * l1], [a[0] + dx, a[1] + dy]];
}
function segPath(a, b, w1, w2) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), nx = -Math.sin(ang), ny = Math.cos(ang), r1 = w1 / 2, r2 = w2 / 2;
  ctx.beginPath();
  ctx.moveTo(a[0] + nx * r1, a[1] + ny * r1); ctx.lineTo(b[0] + nx * r2, b[1] + ny * r2);
  ctx.arc(b[0], b[1], r2, ang + Math.PI / 2, ang - Math.PI / 2, true);
  ctx.lineTo(a[0] - nx * r1, a[1] - ny * r1);
  ctx.arc(a[0], a[1], r1, ang - Math.PI / 2, ang + Math.PI / 2, true);
  ctx.closePath();
}
const LW = 3.4;
function limb(pts, ws, fill, shade) {
  ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.lineWidth = LW;
  for (let i = 0; i < pts.length - 1; i++) { segPath(pts[i], pts[i + 1], ws[i], ws[i + 1]); ctx.stroke(); }
  ctx.fillStyle = fill;
  for (let i = 0; i < pts.length - 1; i++) { segPath(pts[i], pts[i + 1], ws[i], ws[i + 1]); ctx.fill(); }
  if (shade) {
    ctx.fillStyle = shade;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      let nx = -Math.sin(ang), ny = Math.cos(ang); if (ny - nx * 0.6 < 0) { nx = -nx; ny = -ny; }
      const o1 = ws[i] * 0.24, o2 = ws[i + 1] * 0.24;
      segPath([a[0] + nx * o1, a[1] + ny * o1], [b[0] + nx * o2, b[1] + ny * o2], ws[i] * 0.46, ws[i + 1] * 0.46); ctx.fill();
    }
  }
}
function poly(pts, fill, stroke = true) {
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
  if (stroke) { ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.lineWidth = LW; ctx.stroke(); }
  ctx.fillStyle = fill; ctx.fill();
}
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function drawFighter(f) {
  const c = f.ch, st = f.state, lan = f.i === 0;
  const flash = st === 'hit' && f.t > 13;
  const K = k => flash ? '#ffffff' : k;
  const onG = grounded(f), air = !onG && st !== 'ko', crouch = st === 'crouch';

  ctx.fillStyle = 'rgba(8,4,16,.45)';
  ctx.beginPath(); ctx.ellipse(f.x, GROUND + 6, 64 - Math.min(30, (GROUND - f.y) / 5), 9, 0, 0, TAU); ctx.fill();

  let ext = 0;
  if (ATK[st]) {
    const a = ATK[st], rec = a.startup + 6;
    ext = Math.sin(Math.min(1, f.t / (a.startup + 2)) * Math.PI * 0.5) * (f.t > rec ? Math.max(0, 1 - (f.t - rec) / (a.total - rec)) : 1);
  }
  const breath = st === 'idle' ? Math.sin(G.tick * 0.11 + f.i * 2) * 1.6 : 0;
  let hipX = 0, hipY = crouch ? -33 : -56, shY = (crouch ? -66 : -103) + breath, lean = 0.05, tilt = 0;
  if (st === 'walk') hipY -= Math.abs(Math.sin(f.walk)) * 2;
  if (st === 'hit') { lean = -0.32; tilt = -0.35; }
  if (st === 'blockstun') lean = -0.12;
  if (st === 'ko') { lean = -Math.PI / 2 * Math.min(1, f.t / 18); tilt = -0.2; }
  if (st === 'punch') lean = 0.05 + 0.14 * ext;
  if (st === 'special') lean = 0.05 + 0.1 * ext;
  if (st === 'kick') { lean = -0.3 * ext; hipX = 12 * ext; tilt = 0.2 * ext; }
  if (air && !ATK[st]) lean = 0.1;
  const sx = hipX + (crouch ? 7 : 2) + (st === 'punch' ? 7 * ext : 0);

  ctx.save();
  ctx.translate(f.x, f.y + (st === 'ko' && onG ? -15 : 0));
  ctx.scale(f.facing * SPR, SPR);
  ctx.rotate(lean);

  // --- targets ---
  let aF = [20, -6], aB = [-18, -6];
  if (st === 'walk') { const s = Math.sin(f.walk), co = Math.cos(f.walk); aF = [4 + s * 22, -6 - Math.max(0, co) * 12]; aB = [-2 - s * 22, -6 - Math.max(0, -co) * 12]; }
  if (crouch) { aF = [26, -6]; aB = [-20, -6]; }
  if (air && st !== 'kick') { aF = [18, -34]; aB = [-14, -16]; }
  if (st === 'kick') { aF = [hipX + 20 + 80 * ext, -6 - 60 * ext]; aB = [-8, onG ? -6 : -18]; }
  if (st === 'hit') { aF = [14, -6]; aB = [-24, -6]; }
  let hF = [sx + 30, shY + 16], hB = [sx + 15, shY + 27];
  if (st === 'walk') { const s = Math.sin(f.walk) * 3; hF = [sx + 30 - s, shY + 16]; hB = [sx + 15 + s, shY + 27]; }
  if (f.blocking && st !== 'hit' && st !== 'ko') { hF = [sx + 24, shY - 12]; hB = [sx + 21, shY + 3]; }
  if (air && !ATK[st]) { hF = [sx + 24, shY + 2]; hB = [sx - 14, shY + 8]; }
  if (st === 'punch') { hF = [sx + 24 + 58 * ext, shY + 5]; hB = [sx + 3, shY + 22]; }
  if (st === 'special') { hF = [sx + 20 + 42 * ext, shY + 9]; hB = [sx + 18 + 40 * ext, shY + 24]; }
  if (st === 'kick') { hF = [sx + 14, shY + 18]; hB = [sx - 22, shY + 13]; }
  if (st === 'hit' || st === 'ko') { hF = [sx + 20, shY - 20]; hB = [sx - 20, shY - 8]; }

  const hipF = [hipX + 5, hipY], hipB = [hipX - 5, hipY];
  const [kF, fF] = ik(hipF, aF, 32, 33, -1), [kB, fB] = ik(hipB, aB, 32, 33, -1);
  const shF = [sx + 6, shY + 5], shB = [sx - 7, shY + 6];
  const [eF, pF] = ik(shF, hF, 23, 23, 1), [eB, pB] = ik(shB, hB, 23, 23, 1);

  const shoe = (ank, knee, main, sole) => {
    let ang = Math.atan2(ank[1] - knee[1], ank[0] - knee[0]) - Math.PI / 2;
    if (ank[1] > -8 && st !== 'ko') ang = 0;
    ctx.save(); ctx.translate(ank[0], ank[1]); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-7, 6); ctx.lineTo(15, 6); ctx.quadraticCurveTo(20, 5, 17.5, 0);
    ctx.quadraticCurveTo(12, -5, 4, -6); ctx.lineTo(-5, -7); ctx.quadraticCurveTo(-9.5, -1, -7, 6); ctx.closePath();
    ctx.strokeStyle = OUT; ctx.lineWidth = LW; ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = K(main); ctx.fill();
    ctx.strokeStyle = K(sole); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5.5, 4.6); ctx.lineTo(15, 4.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -3.5); ctx.lineTo(8, 1); ctx.stroke();
    ctx.restore();
  };
  const leg = (hip, knee, ank, back) => {
    limb([hip, knee, ank], back ? [17, 14, 10] : [18, 15, 11], K(back ? c.pantsD : c.pants), flash ? null : (back ? null : c.pantsD));
    if (!flash) {
      if (lan) { ctx.strokeStyle = back ? c.trimD : c.trim; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hip[0] + 4, hip[1] + 4); ctx.lineTo(knee[0] + 4, knee[1]); ctx.lineTo(ank[0] + 3, ank[1] - 3); ctx.stroke(); }
      else { const p = lerp2(knee, ank, 0.55), q = lerp2(knee, ank, 0.92); segPath(p, q, 13.5, 11.5); ctx.fillStyle = back ? c.trimD : c.trim; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    shoe(ank, knee, c.shoe, c.sole);
  };
  const fist = (p, e, glove, back) => {
    const ang = Math.atan2(p[1] - e[1], p[0] - e[0]);
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang);
    ctx.beginPath(); ctx.ellipse(2.5, 0, 7.6, 6.8, 0, 0, TAU);
    ctx.strokeStyle = OUT; ctx.lineWidth = LW; ctx.stroke(); ctx.fillStyle = K(glove); ctx.fill();
    if (!flash) {
      ctx.strokeStyle = 'rgba(20,13,32,.55)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(6.5, k * 3.2); ctx.lineTo(9, k * 3.2); ctx.stroke(); }
      ctx.fillStyle = back ? c.trimD : c.trim; ctx.fillRect(-7.5, -5.2, 4.2, 10.4); ctx.strokeStyle = OUT; ctx.lineWidth = 1.1; ctx.strokeRect(-7.5, -5.2, 4.2, 10.4);
    }
    ctx.restore();
  };
  const arm = (sh, el, p, back) => {
    const skin = K(back ? c.skinD : c.skin);
    if (lan) {
      limb([el, p], [11.5, 9], skin, flash || back ? null : c.skinD);
      limb([sh, el], [14.5, 12.5], K(back ? c.dark : c.body), flash || back ? null : c.dark);
      if (!flash) { segPath(lerp2(sh, el, 0.82), lerp2(sh, el, 1), 13.5, 13.5); ctx.fillStyle = back ? c.trimD : c.trim; ctx.fill(); }
      fist(p, el, back ? c.dark : c.body, back);
    } else {
      limb([sh, el, p], [13.5, 11.5, 9], skin, flash || back ? null : c.skinD);
      if (!flash) { segPath(lerp2(sh, el, 0.35), lerp2(sh, el, 0.55), 14, 13.6); ctx.fillStyle = back ? c.trimD : c.trim; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.1; ctx.stroke(); }
      fist(p, el, back ? c.skinD : c.skin, back);
    }
  };

  // --- back limbs ---
  arm(shB, eB, pB, true);
  leg(hipB, kB, fB, true);
  // --- YAN sash tail ---
  if (!lan) { const sw = Math.sin(G.tick * 0.15) * 3 - f.vx * 1.2 * f.facing; limb([[hipX - 8, hipY + 2], [hipX - 15 + sw * 0.5, hipY + 16], [hipX - 17 + sw, hipY + 32]], [8, 7, 4], K(c.trimD)); }
  // --- pelvis + front leg ---
  ctx.beginPath(); ctx.arc(hipX, hipY + 3, 11.5, 0, TAU); ctx.strokeStyle = OUT; ctx.lineWidth = LW; ctx.stroke(); ctx.fillStyle = K(c.pants); ctx.fill();
  leg(hipF, kF, fF, false);

  // --- torso ---
  const T = [[hipX - 11.5, hipY + 5], [hipX + 11.5, hipY + 5], [sx + 14.5, shY + 18], [sx + 13, shY + 2], [sx + 3, shY - 4], [sx - 11, shY - 1], [sx - 14.5, shY + 15]];
  poly(T, K(c.body));
  if (!flash) {
    poly([[hipX - 11.5, hipY + 5], [hipX - 3, hipY + 5], [sx - 5, shY + 15], [sx - 4, shY - 1], [sx - 11, shY - 1], [sx - 14.5, shY + 15]], c.dark, false);
    poly([[sx + 6, shY + 1], [sx + 12, shY + 3], [sx + 13.5, shY + 15], [sx + 8, shY + 13]], c.light, false);
    if (lan) {           // open jacket over a pale tee, collar, hem
      poly([[hipX + 3.5, hipY + 3], [hipX + 11, hipY + 3], [sx + 14, shY + 18], [sx + 11.5, shY + 5], [sx + 7, shY + 4]], c.trim, false);
      ctx.strokeStyle = OUT; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(hipX + 3.5, hipY + 3); ctx.lineTo(sx + 7, shY + 4); ctx.stroke();
      ctx.strokeStyle = c.trimD; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hipX + 7, hipY - 8); ctx.lineTo(sx + 11, shY + 22); ctx.stroke();
      segPath([hipX - 10.5, hipY + 3], [hipX + 10.5, hipY + 3], 6, 6); ctx.fillStyle = c.dark; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.3; ctx.stroke();
    } else {             // vest with gold edging and waist sash
      ctx.strokeStyle = c.trim; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(hipX + 9.5, hipY + 2); ctx.lineTo(sx + 12.5, shY + 17); ctx.lineTo(sx + 9, shY + 2); ctx.stroke();
      ctx.fillStyle = c.skin; ctx.beginPath(); ctx.moveTo(sx + 2, shY - 3); ctx.lineTo(sx + 9, shY); ctx.lineTo(sx + 5, shY + 10); ctx.closePath(); ctx.fill();
      segPath([hipX - 10.5, hipY + 2], [hipX + 10.5, hipY + 2], 8, 8); ctx.fillStyle = c.trim; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.beginPath(); ctx.arc(hipX - 7, hipY + 2, 3.4, 0, TAU); ctx.fillStyle = c.trimD; ctx.fill(); ctx.stroke();
    }
  }

  // --- neck + head ---
  limb([[sx + 2, shY - 1], [sx + 4.5, shY - 11]], [9.5, 8.5], K(c.skinD));
  ctx.save(); ctx.translate(sx + 5.5, shY - 22); ctx.rotate(tilt);
  const headShape = () => {
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 13.5, 0, 0, TAU); ctx.moveTo(10.5, -2); ctx.lineTo(15, 2.6); ctx.lineTo(11, 5);
    ctx.moveTo(1, 12.5); ctx.lineTo(8.5, 13.6); ctx.lineTo(11.5, 6); ctx.lineTo(4, 4); ctx.closePath();
  };
  headShape(); ctx.strokeStyle = OUT; ctx.lineWidth = LW; ctx.lineJoin = 'round'; ctx.stroke();
  headShape(); ctx.fillStyle = K(c.skin); ctx.fill();
  if (!flash) {
    ctx.fillStyle = c.skinD; ctx.beginPath(); ctx.ellipse(-3.5, 1.5, 2.8, 4, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-9, 6); ctx.quadraticCurveTo(-2, 14, 7, 13); ctx.quadraticCurveTo(-2, 12, -6, 5); ctx.fill();
    const hurt = st === 'hit' || st === 'ko', yell = ATK[st] && ext > 0.4;
    ctx.strokeStyle = OUT; ctx.lineCap = 'round';
    if (lan) {
      ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(3, -6.5); ctx.lineTo(10.5, hurt ? -7.5 : -4.6); ctx.stroke();
      if (hurt) { ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(4.5, -2.5); ctx.lineTo(9, -0.5); ctx.moveTo(9, -3); ctx.lineTo(4.5, -0.5); ctx.stroke(); }
      else { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(7, -1.4, 3, 2.4, 0, 0, TAU); ctx.fill(); ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(8, -1.3, 1.7, 2.2, 0, 0, TAU); ctx.fill(); }
    }
    if (hurt || yell) { ctx.fillStyle = '#5a1620'; ctx.beginPath(); ctx.ellipse(8.5, 8, 2.6, hurt ? 3.2 : 2.4, 0.2, 0, TAU); ctx.fill(); ctx.lineWidth = 1.2; ctx.stroke(); }
    else { ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(6, 8.2); ctx.lineTo(11, 7.4); ctx.stroke(); }
  }
  if (lan) {             // knit beanie with fold band and pom-pom
    ctx.beginPath(); ctx.arc(-3, -20, 5.4, 0, TAU); ctx.strokeStyle = OUT; ctx.lineWidth = LW; ctx.stroke(); ctx.fillStyle = K(c.trim); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-13.5, -3); ctx.bezierCurveTo(-15, -22, 12, -23, 13.5, -5.5); ctx.closePath();
    ctx.stroke(); ctx.fillStyle = K(c.light); ctx.fill();
    if (!flash) { ctx.strokeStyle = c.body; ctx.lineWidth = 1.3; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 4.6, -8); ctx.quadraticCurveTo(k * 4, -14, k * 2.6 - 1, -18.5); ctx.stroke(); } }
    segPath([-13, -3.4], [13, -5.6], 7, 7); ctx.strokeStyle = OUT; ctx.lineWidth = LW; ctx.stroke(); ctx.fillStyle = K(c.trim); ctx.fill();
    if (!flash) { poly([[-12, 1], [-14.5, 8], [-8, 4]], c.hair, false); ctx.fillStyle = c.trimD; for (let k = -2; k <= 2; k++) ctx.fillRect(k * 5 - 0.6, -7.4 - k * 0.42, 1.2, 6); }
  } else {               // swept-back spikes and a wraparound visor
    poly([[-13, 3], [-17, -7], [-11.5, -8.5], [-17, -19], [-8, -15], [-8.5, -26], [-0.5, -17.5], [4, -25], [6.5, -15.5], [13.5, -18.5], [11.5, -8.5], [12.5, -5], [4, -9.5], [-4, -8.5], [-8, -2], [-10, 5]], K(c.hair));
    if (!flash) {
      ctx.strokeStyle = '#7a3418'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      [[-6, -11, -7.5, -21], [1, -11.5, 3, -20], [-11, -6, -13.5, -14]].forEach(l => { ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke(); });
      ctx.strokeStyle = c.trimD; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-11.5, -3.6); ctx.lineTo(2, -3.6); ctx.stroke();
      poly([[0.5, -6.6], [14.5, -5.4], [14.8, 0.4], [9, 1.6], [1.5, 0.2]], '#20120c');
      ctx.strokeStyle = c.trim; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(1, -6.4); ctx.lineTo(14.4, -5.3); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(4, -4.4); ctx.lineTo(7.5, -1.2); ctx.stroke();
    }
  }
  ctx.restore();

  // --- LAN scarf ---
  if (lan) {
    const fl = Math.sin(G.tick * 0.17) * 3, drag = -f.vx * 1.6 * f.facing;
    limb([[sx - 6, shY - 4], [sx - 17 + drag * 0.5, shY + 5 + fl * 0.4], [sx - 23 + drag, shY + 20 - fl]], [9.5, 8.5, 6], K(c.trim));
    if (!flash) { const a = [sx - 17 + drag * 0.5, shY + 5 + fl * 0.4], b = [sx - 23 + drag, shY + 20 - fl]; segPath(lerp2(a, b, 0.5), lerp2(a, b, 0.78), 7.4, 6.6); ctx.fillStyle = c.light; ctx.fill(); }
    limb([[sx - 6, shY - 5], [sx + 12.5, shY - 3.5]], [11, 11], K(c.trim), flash ? null : c.trimD);
  }

  // --- front arm ---
  arm(shF, eF, pF, false);

  // --- effects ---
  if (st === 'special' && f.t < ATK.special.startup + 4) {
    const gx = (pF[0] + pB[0]) / 2 + 12, gy = (pF[1] + pB[1]) / 2, r = 8 + f.t * 1.5;
    const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c.fx); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.fill();
  }
  if ((st === 'punch' || st === 'kick') && f.t >= ATK[st].startup - 2 && f.t < ATK[st].startup + ATK[st].active + 1) {
    const tip = st === 'punch' ? pF : fF, from = st === 'punch' ? eF : kF;
    const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    ctx.save(); ctx.translate(tip[0], tip[1]); ctx.rotate(ang); ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.quadraticCurveTo(-6, -17, -34, -13); ctx.quadraticCurveTo(-10, -9, -2, 0); ctx.quadraticCurveTo(-10, 9, -34, 13); ctx.quadraticCurveTo(-6, 17, 14, 0); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawShot(s) {
  const c = s.owner.ch, d = Math.sign(s.vx), x = s.x, y = s.y, t = G.tick;
  let g = ctx.createRadialGradient(x, y, 2, x, y, 46);
  g.addColorStop(0, 'rgba(255,255,255,.7)'); g.addColorStop(0.3, c.fx + 'aa'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 46, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.scale(d, 1); ctx.lineCap = 'round';
  if (s.owner.i === 0) {   // LAN: layered wind crescents
    for (let k = 2; k >= 0; k--) {
      const r = 26 - k * 6, ox = -k * 17, wob = Math.sin(t * 0.5 + k) * 0.12;
      const cres = () => { ctx.beginPath(); ctx.arc(ox, 0, r, -1.15 + wob, 1.15 + wob); ctx.quadraticCurveTo(ox + r * 0.55, 0, ox + Math.cos(-1.15 + wob) * r, Math.sin(-1.15 + wob) * r); ctx.closePath(); };
      cres(); ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = k === 0 ? '#ffffff' : k === 1 ? c.fx : c.fxD; ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) { const yy = ((t * 5 + k * 13) % 44) - 22, xx = -30 - ((t * 7 + k * 17) % 40); ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - 18, yy); ctx.stroke(); }
  } else {                 // YAN: spinning ember shard with a flame tail
    for (let k = 4; k >= 1; k--) {
      const fl = Math.sin(t * 0.6 + k * 1.7) * 5;
      ctx.fillStyle = k > 2 ? c.fxD : c.fx; ctx.globalAlpha = 0.9 - k * 0.15;
      ctx.beginPath(); ctx.moveTo(-k * 12, -13 + k * 2); ctx.quadraticCurveTo(-k * 20 - 12, fl, -k * 12, 13 - k * 2); ctx.quadraticCurveTo(-k * 12 + 8, 0, -k * 12, -13 + k * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.rotate(t * 0.35);
    [[20, OUT], [16.5, c.fxD], [11.5, c.fx], [6, '#ffffff']].forEach(([r, col]) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(0, r * 0.72); ctx.lineTo(-r, 0); ctx.lineTo(0, -r * 0.72); ctx.closePath(); ctx.fill();
    });
  }
  ctx.restore();
}

function drawSparks() {
  ctx.lineCap = 'round';
  for (const p of G.sparks) {
    if (p.big) {
      const k = (6 - p.life) / 6, r = 16 + k * 34;
      ctx.globalAlpha = 1 - k * 0.8; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8 + p.x * 0.01, rr = i % 2 ? r * 0.38 : r; ctx[i ? 'lineTo' : 'moveTo'](p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.globalAlpha = Math.min(1, p.life / 8); ctx.strokeStyle = p.color; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  const [a, b] = G.fighters, bw = 384, bh = 22, y = 40;
  [[a, 40, 1], [b, W - 40 - bw, -1]].forEach(([f, x, d]) => {
    ctx.fillStyle = OUT; ctx.fillRect(x - 5, y - 5, bw + 10, bh + 10);
    ctx.fillStyle = '#f6f2ff'; ctx.fillRect(x - 2.5, y - 2.5, bw + 5, bh + 5);
    ctx.fillStyle = '#6a1220'; ctx.fillRect(x, y, bw, bh);
    const wS = bw * f.shownHp / 100, wH = bw * f.hp / 100;
    ctx.fillStyle = '#ff4a3a'; ctx.fillRect(d === 1 ? x + bw - wS : x, y, wS, bh);
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    if (f.hp > 30) { g.addColorStop(0, '#fff6b0'); g.addColorStop(0.45, '#ffd23f'); g.addColorStop(1, '#e89a1e'); }
    else { g.addColorStop(0, '#ffc0a0'); g.addColorStop(0.45, '#ff6a3c'); g.addColorStop(1, '#c4281e'); }
    ctx.fillStyle = g; ctx.fillRect(d === 1 ? x + bw - wH : x, y, wH, bh);
    const ew = 180, ex = d === 1 ? x : x + bw - ew, we = ew * f.energy / 100, ready = f.energy >= ATK.special.cost;
    ctx.fillStyle = OUT; ctx.fillRect(ex - 3, y + bh + 9, ew + 6, 13);
    ctx.fillStyle = '#2a2244'; ctx.fillRect(ex, y + bh + 12, ew, 7);
    ctx.fillStyle = ready ? (G.tick % 24 < 12 ? f.ch.fx : '#ffffff') : '#7a7694';
    ctx.fillRect(d === 1 ? ex : ex + ew - we, y + bh + 12, we, 7);
    ctx.fillStyle = OUT; ctx.fillRect(ex + (d === 1 ? ew * 0.35 : ew * 0.65) - 1, y + bh + 12, 2, 7);
    const tag = f.i === 0 ? 'P1' : G.mode === 'cpu' ? 'CPU' : 'P2';
    txt(f.ch.name, d === 1 ? x : x + bw, 20, 24, f.ch.light, d === 1 ? 'left' : 'right');
    txt(tag, d === 1 ? x + 58 : x + bw - 58, 21, 13, '#d8d0f0', d === 1 ? 'left' : 'right', true);
    for (let i = 0; i < WINS_NEEDED; i++) {
      const wx = d === 1 ? x + bw - 12 - i * 24 : x + 12 + i * 24;
      ctx.beginPath(); ctx.arc(wx, y + bh + 16, 8, 0, TAU); ctx.fillStyle = OUT; ctx.fill();
      ctx.beginPath(); ctx.arc(wx, y + bh + 16, 5.5, 0, TAU); ctx.fillStyle = i < f.wins ? '#ffd23f' : '#3a3352'; ctx.fill();
    }
    if (f.combo >= 2) { txt(f.combo + ' HITS', d === 1 ? 48 : W - 48, 132, 40, 'gold', d === 1 ? 'left' : 'right'); }
  });
  ctx.fillStyle = OUT; ctx.fillRect(W / 2 - 34, 22, 68, 56);
  ctx.fillStyle = '#2a2244'; ctx.fillRect(W / 2 - 30, 26, 60, 48);
  txt(String(G.timer).padStart(2, '0'), W / 2, 52, 42, G.timer <= 10 ? '#ff5a3c' : '#ffffff');
}

function drawMenu() {
  drawStage();
  ctx.fillStyle = 'rgba(10,6,22,.66)'; ctx.fillRect(0, 0, W, H);
  txt('STREEFIGHT', W / 2, 112, 124, 'gold');
  txt('ARCADE BRAWLER', W / 2, 186, 22, '#ffb38a');
  const items = ['1P VS CPU', '2P VERSUS', 'CPU LEVEL:  ' + ['EASY', 'NORMAL', 'HARD'][G.level]];
  items.forEach((s, i) => {
    const sel = i === G.menuSel, y = 250 + i * 48;
    if (sel) {
      ctx.fillStyle = 'rgba(255,210,63,.16)'; ctx.fillRect(W / 2 - 200, y - 22, 400, 44);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(W / 2 - 200, y - 22, 400, 2.5); ctx.fillRect(W / 2 - 200, y + 19.5, 400, 2.5);
      if (G.tick % 30 < 20) txt('>', W / 2 - 176, y, 30, '#ffd23f');
    }
    txt(s, W / 2, y, 32, sel ? '#ffffff' : '#9a92b4');
  });
  if (G.tick % 60 < 40) txt('PRESS ENTER', W / 2, 398, 18, '#ffffff');
  txt('P1:  A / D  move    W  jump    S  crouch    J  punch    K  kick    L  special', W / 2, 434, 14.5, '#a8d8ff', 'center', true);
  txt('P2:  Arrows  move / jump / crouch    ,  punch    .  kick    /  special', W / 2, 456, 14.5, '#ffb8a8', 'center', true);
  txt('Hold BACK to block    •    Down, Down-Forward, Forward + Punch = special', W / 2, 482, 14.5, '#f0e8ff', 'center', true);
  txt('Punch > Kick > Special = combo    •    M  music    F11  fullscreen    Esc  pause', W / 2, 504, 14.5, '#b0a8c8', 'center', true);
}

function draw() {
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  if (G.scene === 'menu') { drawMenu(); return; }
  if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  drawStage();
  G.fighters.slice().sort((p, q) => (ATK[p.state] ? 1 : 0) - (ATK[q.state] ? 1 : 0)).forEach(drawFighter);
  G.shots.forEach(drawShot);
  drawSparks();
  for (const p of G.popups) if (p.life > 12 || p.life % 4 < 2) txt(p.text, Math.max(110, Math.min(W - 110, p.x)), p.y, 24, p.color);
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  drawHUD();

  if (G.scene === 'intro') {
    if (G.sceneT < 70) txt('ROUND ' + G.round, W / 2, 220, 96, '#ffffff');
    else { const k = Math.min(1, (G.sceneT - 70) / 8); txt('FIGHT!', W / 2, 220, 150 - k * 20, 'gold'); }
  } else if (G.scene === 'roundEnd') {
    txt(G.banner, W / 2, 210, G.banner === 'K.O.' ? 170 : 110, 'red');
    if (G.sub && G.sceneT > 40) txt(G.sub, W / 2, 310, 52, 'gold');
  } else if (G.scene === 'matchEnd') {
    const [a, b] = G.fighters, w = a.wins > b.wins ? a : b;
    ctx.fillStyle = 'rgba(10,6,22,.78)'; ctx.fillRect(0, 140, W, 200);
    ctx.fillStyle = w.ch.fx; ctx.fillRect(0, 140, W, 3); ctx.fillRect(0, 337, W, 3);
    txt(w.ch.name + ' WINS', W / 2, 212, 96, w.ch.fx);
    txt(G.mode === 'cpu' ? (w.i === 0 ? 'YOU WIN!' : 'YOU LOSE') : 'PLAYER ' + (w.i + 1) + ' WINS', W / 2, 284, 30, '#ffffff');
    if (G.sceneT > 40 && G.tick % 60 < 40) txt('PRESS ENTER', W / 2, 320, 16, '#d8d0f0');
  }
  if (G.paused) {
    ctx.fillStyle = 'rgba(8,4,18,.72)'; ctx.fillRect(0, 0, W, H);
    txt('PAUSED', W / 2, 230, 96, '#ffffff');
    txt('Esc  resume        Q  quit to menu', W / 2, 310, 18, '#d8d0f0', 'center', true);
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
