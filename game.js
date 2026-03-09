// ─────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
const lowFxMode = coarsePointer
  || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  || ((navigator.hardwareConcurrency || 8) <= 4)
  || ((navigator.deviceMemory || 8) <= 4);
const STAR_COUNT = lowFxMode ? 28 : 80;
const MAX_PARTICLES = lowFxMode ? 120 : 320;
const ONLINE_STATE_SYNC_MS = lowFxMode ? 80 : 50;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

const MAX_LIVES = 5;
const ARENA_RADIUS_RATIO = 0.78;
let arenaX, arenaY, arenaR;
let round = 1;

// ─────────────────────────────────────────────
// SPELLS CONFIG
// ─────────────────────────────────────────────

// ══════════════════════════════════════════
// SOUND ENGINE  (Web Audio API)
// ══════════════════════════════════════════
const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let muted = false;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  // ── Core helpers ──
  function osc(freq, type, startT, dur, gainPeak, freqEnd) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, startT);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(freqEnd, startT + dur);
    g.gain.setValueAtTime(0, startT);
    g.gain.linearRampToValueAtTime(gainPeak, startT + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
    o.connect(g); g.connect(masterGain);
    o.start(startT); o.stop(startT + dur + 0.01);
  }

  function noise(startT, dur, gainPeak, freq1, freq2) {
    // White noise via buffer
    const bufSz = ctx.sampleRate * dur;
    const buf   = ctx.createBuffer(1, bufSz, ctx.sampleRate);
    const data  = buf.getChannelData(0);
    for (let i = 0; i < bufSz; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(freq1 || 1000, startT);
    if (freq2) bpf.frequency.exponentialRampToValueAtTime(freq2, startT + dur);
    bpf.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainPeak, startT);
    g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
    src.connect(bpf); bpf.connect(g); g.connect(masterGain);
    src.start(startT); src.stop(startT + dur + 0.01);
  }

  // ── Spell sounds ──
  function fireball() {
    init(); resume(); const t = ctx.currentTime;
    noise(t,      0.12, 0.4, 400, 120);   // whoosh burst
    osc(180, 'sawtooth', t, 0.25, 0.3, 60);
    noise(t+0.05, 0.2,  0.25, 250, 80);
  }

  function lightning() {
    init(); resume(); const t = ctx.currentTime;
    // Sharp crack
    noise(t, 0.05, 0.9, 3000, 400);
    osc(1200, 'sawtooth', t, 0.08, 0.5, 200);
    noise(t+0.04, 0.15, 0.4, 800, 200);
    osc(600, 'square', t+0.02, 0.12, 0.2, 100);
  }

  function homing() {
    init(); resume(); const t = ctx.currentTime;
    osc(300, 'sine', t, 0.4, 0.25, 600);   // rising lock-on tone
    noise(t, 0.15, 0.15, 200, 400);
  }

  function shield() {
    init(); resume(); const t = ctx.currentTime;
    osc(440, 'sine', t,      0.15, 0.3, 880);
    osc(880, 'sine', t+0.1,  0.25, 0.25, 1200);
    osc(1200,'sine', t+0.18, 0.2,  0.2, 1600);
  }

  function thrust() {
    init(); resume(); const t = ctx.currentTime;
    noise(t, 0.18, 0.5, 800, 150);          // swoosh
    osc(200, 'sawtooth', t, 0.18, 0.35, 80);
  }

  function gravity() {
    init(); resume(); const t = ctx.currentTime;
    osc(80,  'sine', t, 0.6, 0.4, 40);
    osc(160, 'sine', t, 0.4, 0.2, 60);
    noise(t, 0.5, 0.15, 100, 60);
  }

  function meteor() {
    init(); resume(); const t = ctx.currentTime;
    noise(t, 0.1, 0.5, 3000, 500);          // entry whistle
    osc(150, 'sawtooth', t, 0.35, 0.4, 50); // rumble
    noise(t+0.05, 0.3, 0.6, 600, 100);
  }

  function icebolt() {
    init(); resume(); const t = ctx.currentTime;
    osc(1400, 'sine', t, 0.2,  0.3, 700);
    osc(700,  'sine', t+0.05, 0.25, 0.25, 350);
    noise(t, 0.18, 0.2, 2000, 400);
  }

  // ── Hit / damage ──
  function hit(isPlayer) {
    init(); resume(); const t = ctx.currentTime;
    if (isPlayer) {
      noise(t, 0.08, 0.6, 600, 150);
      osc(120, 'sawtooth', t, 0.12, 0.5, 60);
    } else {
      noise(t, 0.07, 0.35, 400, 180);
      osc(180, 'square', t, 0.1, 0.25, 90);
    }
  }

  // ── Death ──
  function death(isPlayer) {
    init(); resume(); const t = ctx.currentTime;
    if (isPlayer) {
      osc(220, 'sawtooth', t, 0.6, 0.4, 50);
      noise(t, 0.4, 0.5, 400, 80);
      osc(110, 'sine', t+0.2, 0.5, 0.3, 40);
    } else {
      osc(300, 'sawtooth', t, 0.35, 0.3, 80);
      noise(t, 0.25, 0.35, 600, 100);
    }
  }

  // ── Freeze ──
  function freeze() {
    init(); resume(); const t = ctx.currentTime;
    osc(800, 'sine', t,     0.2,  0.3, 1600);
    osc(1600,'sine', t+0.1, 0.15, 0.2, 3000);
  }

  // ── Lava death ──
  function lavaDeath() {
    init(); resume(); const t = ctx.currentTime;
    noise(t, 0.5, 0.7, 200, 50);
    osc(60, 'sine', t, 0.5, 0.5, 30);
  }

  // ── Countdown beep ──
  function countdownBeep(n) {
    init(); resume(); const t = ctx.currentTime;
    const freq = n === 0 ? 1200 : 600; // GO! is higher
    const dur  = n === 0 ? 0.35 : 0.18;
    osc(freq, 'sine', t, dur, 0.5, freq * (n === 0 ? 1.5 : 1));
    if (n === 0) osc(freq * 1.5, 'sine', t + 0.05, 0.3, 0.3, freq * 2);
  }

  // ── Gold pickup ──
  function goldPickup() {
    init(); resume(); const t = ctx.currentTime;
    osc(880,  'sine', t,      0.12, 0.25, 1320);
    osc(1320, 'sine', t+0.08, 0.1,  0.2,  1760);
  }

  // ── Lava shrink warning pulse ──
  function lavaShrink() {
    init(); resume(); const t = ctx.currentTime;
    osc(80, 'sine', t, 0.3, 0.35, 60);
    noise(t, 0.25, 0.2, 300, 80);
  }

  // ── Shield block ──
  function shieldBlock() {
    init(); resume(); const t = ctx.currentTime;
    osc(600, 'sine', t, 0.15, 0.4, 900);
    noise(t, 0.1, 0.25, 1200, 400);
  }

  // ── Round start jingle ──
  function roundStart() {
    init(); resume(); const t = ctx.currentTime;
    osc(523, 'sine', t,      0.12, 0.3);
    osc(659, 'sine', t+0.1,  0.12, 0.3);
    osc(784, 'sine', t+0.2,  0.15, 0.35);
    osc(1047,'sine', t+0.3,  0.2,  0.4);
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  // Resume on first user interaction
  document.addEventListener('touchstart', () => { init(); resume(); }, { once: true });
  document.addEventListener('mousedown',  () => { init(); resume(); }, { once: true });

  return { fireball, lightning, homing, shield, thrust, gravity, meteor, icebolt,
           hit, death, freeze, lavaDeath, goldPickup, goldPickup, lavaShrink, shieldBlock,
           countdownBeep, roundStart, toggleMute, resume, init };
})();

const SPELLS = {
  fireball:  { cd: 1200, damage: 18, speed: 4.4, color: '#ff6b35', glow: '#ff4400', radius: 10 },
  lightning: { cd: 2000, damage: 30, speed: 9, range: 280, color: '#ffd700', glow: '#ffee44', radius: 7 },
  homing:    { cd: 2500, damage: 22, speed: 2.8, color: '#4fc3f7', glow: '#0088cc', radius: 10, homing: true },
  shield:    { cd: 5000, duration: 2500, color: '#81c784', glow: '#33ff66' },
  thrust:    { cd: 3000, damage: 25, dashSpeed: 42, color: '#ce93d8', glow: '#aa44ff' },
  gravity:   { cd: 4000, damage: 15, radius: 90, duration: 1500, color: '#b0bec5', glow: '#ffffff' },
  meteor:    { cd: 5000, damage: 55, speed: 3.5, color: '#ff4400', glow: '#ff2200', radius: 18, aoe: true, aoeRadius: 70 },
  icebolt:   { cd: 1800, damage: 20, speed: 4.5, color: '#a8e6ff', glow: '#55ccff', radius: 9, freeze: true, freezeDur: 800 },
};

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
let projectiles = [];
let particles   = [];
let effects     = [];
let gameRunning = false;
let lavaAngle   = 0;
let lavaRadius  = 1.0;   // multiplier, shrinks to 0.45 over time
let lavaLastTime = 0;
let lavaWarned   = false;
let playerGold  = 0;
let shopOpen      = false;
let countdownVal    = 0;   // 3,2,1,0 = go
let countdownTime   = 0;
let spectatorMode   = false;
let isBossRound     = false;
let bossPlayer      = null; // reference to boss player object
let screenShake     = 0;    // pixels, decays
let laserTelegraphs = [];   // {x1,y1,x2,y2, timer, maxTimer}
let spectatorTarget = null; // bot index being followed
let spectatorSwapTimer = 0; // ms until next cam swap

function clearLaserTelegraphs(kind) {
  if (!kind) {
    laserTelegraphs = [];
    return;
  }
  laserTelegraphs = laserTelegraphs.filter(t => t.kind !== kind);
}

// All purchasable spells and upgrades in the shop
const SHOP_ITEMS = [
  { id:'lightning',name:'Lightning',icon:'⚡', cost:60,  type:'spell',   desc:'Aim & shoot bolt' },
  { id:'homing',  name:'Homing',   icon:'💙', cost:80,  type:'spell',   desc:'Tracking missile' },
  { id:'shield',  name:'Shield',   icon:'🛡️', cost:70,  type:'spell',   desc:'Protective barrier' },
  { id:'gravity', name:'Gravity',  icon:'🌀', cost:120, type:'spell',   desc:'Pull enemies in' },
  { id:'meteor',  name:'Meteor',   icon:'☄️',  cost:300, type:'spell',   desc:'Massive AoE explosion' },
  { id:'icebolt', name:'Ice Bolt', icon:'🧊',  cost:25,  type:'spell',   desc:'Freezes enemy briefly' },
  { id:'upg_fireball', name:'Fireball+', icon:'🔥', cost:80, type:'upgrade', spell:'fireball', desc:'+12 dmg, -20% CD' },
  { id:'upg_lightning',name:'Lightning+',icon:'⚡', cost:100,type:'upgrade', spell:'lightning',desc:'+20 dmg, -20% CD' },
  { id:'upg_homing',   name:'Homing+',  icon:'💙', cost:90, type:'upgrade', spell:'homing',   desc:'+15 dmg, -20% CD' },
  { id:'upg_thrust',   name:'Dash+',    icon:'💨', cost:120,type:'upgrade', spell:'thrust',   desc:'+50% dash speed' },
  { id:'upg_shield',   name:'Shield+',  icon:'🛡️', cost:75,  type:'upgrade', spell:'shield',   desc:'+1.5s duration' },
  { id:'upg_speed',    name:'Swift Cast', icon:'💫', cost:60,  type:'upgrade', spell:'fireball', desc:'+30% proj speed all' },
];

const FIREBALL_LEVELS = [
  null, // 0 unused
  { desc:'Starter fireball', cost:0 },           // L1
  { desc:'+10 dmg, -20% CD',  cost:80,  fn: s => { s.damage+=10; s.cd=Math.round(s.cd*0.8); } },
  { desc:'+20% proj speed',   cost:100, fn: s => { s.speed*=1.2; } },
  { desc:'+10 dmg, +50% knockback', cost:120, fn: s => { s.damage+=10; s.kbMult=(s.kbMult||1)*1.5; } },
  { desc:'Split-shot: fires 3 bolts', cost:150, fn: s => { s.splitShot=3; } },
  { desc:'-20% CD, +15 dmg',  cost:180, fn: s => { s.cd=Math.round(s.cd*0.8); s.damage+=15; } },
  { desc:'+25% speed, bigger blast radius', cost:200, fn: s => { s.speed*=1.25; s.radius=Math.round(s.radius*1.5); } },
  { desc:'On hit: small AoE explosion', cost:240, fn: s => { s.miniAoe=true; s.miniAoeRadius=40; } },
  { desc:'+20 dmg, pierce through targets', cost:280, fn: s => { s.damage+=20; s.pierce=true; } },
  { desc:'INFERNO: triple shot, AoE, +30 dmg', cost:350, fn: s => { s.splitShot=3; s.miniAoe=true; s.miniAoeRadius=55; s.damage+=30; s.kbMult=(s.kbMult||1)*2; } },
];

const LIGHTNING_LEVELS = [
  null,
  { desc:'Aim & shoot, limited range', cost:0 },   // L1 - starter behaviour
  { desc:'Chain: hits +1 nearby enemy', cost:80,  fn: s => { s.chainCount=(s.chainCount||0)+1; } },
  { desc:'+10 dmg, -20% CD',   cost:100, fn: s => { s.damage+=10; s.cd=Math.round(s.cd*0.8); } },
  { desc:'+50% range',         cost:120, fn: s => { s.range=Math.round(s.range*1.5); } },
  { desc:'Fork: splits to 2 targets', cost:150, fn: s => { s.fork=true; } },
  { desc:'+10 dmg, stun 0.3s', cost:180, fn: s => { s.damage+=10; s.stunDur=300; } },
  { desc:'-20% CD, +20% bolt speed', cost:200, fn: s => { s.cd=Math.round(s.cd*0.8); s.speed*=1.2; } },
  { desc:'Chain: hits +2 more enemies', cost:240, fn: s => { s.chainCount=(s.chainCount||0)+2; } },
  { desc:'+25 dmg, massive range boost', cost:280, fn: s => { s.damage+=25; s.range=Math.round(s.range*1.5); } },
  { desc:'STORM: AoE lightning, stuns all nearby', cost:350, fn: s => { s.stormAoe=true; s.stormRadius=150; s.damage+=30; s.stunDur=500; } },
];


function makePlayer(id, name, color, glowColor, isBot) {
  return {
    id, name, color, glowColor,
    x: 0, y: 0, vx: 0, vy: 0,
    damage: 0, lives: MAX_LIVES,
    angle: 0, radius: 18,
    activeSpells: ['fireball','lightning','homing','shield','thrust','gravity'],
    upgrades: {},
    spellLevels: {},
    gold: 0,
    cooldowns: {},
    frozenUntil: 0,
    shieldActive: false, shieldTimer: 0,
    thrusting: false, thrustTimer: 0,
    isBot, dead: false, deadTimer: 0,
    botTarget: null, botActionTimer: 0, botSpellTimer: 0,
    walkPhase: 0, idlePhase: Math.random()*Math.PI*2,
    isMoving: false, castFlash: 0, deathSpin: 0,
    hitFlash: 0, dashFlash: 0, dashTrail: [],
    hitLog: [],    // [{attackerId, time}] last 2s
    lastHitBy: -1, // attacker id of final blow
  };
}

const BOT_NAMES  = ['Sorcerer','Conjurer','Hex','Shade','Cursed'];
const BOT_COLORS = ['#4fc3f7','#a78bfa','#34d399','#f87171','#fbbf24'];
const BOT_GLOWS  = ['#0088cc','#7c3aed','#059669','#dc2626','#d97706'];

const players = [
  makePlayer(0,'You','#ff6b35','#ff4400',false),
  makePlayer(1,BOT_NAMES[0],BOT_COLORS[0],BOT_GLOWS[0],true),
  makePlayer(2,BOT_NAMES[1],BOT_COLORS[1],BOT_GLOWS[1],true),
  makePlayer(3,BOT_NAMES[2],BOT_COLORS[2],BOT_GLOWS[2],true),
  makePlayer(4,BOT_NAMES[3],BOT_COLORS[3],BOT_GLOWS[3],true),
  makePlayer(5,BOT_NAMES[4],BOT_COLORS[4],BOT_GLOWS[4],true),
];

// ─────────────────────────────────────────────
// INPUT MODE DETECTION
// ─────────────────────────────────────────────
let inputMode = 'touch'; // 'touch' | 'pc'
const pcHint = document.getElementById('pcHint');
const mouseCursor = document.getElementById('mouse-cursor');
const controlsEl = document.getElementById('controls');
const overlayEl = document.getElementById('overlay');
const menuViewEl = document.getElementById('menuView');
const resultPanelEl = document.getElementById('resultPanel');
const resultTitleEl = document.getElementById('resultTitle');
const resultTextEl = document.getElementById('resultText');
const resultSubtitleEl = document.getElementById('resultSubtitle');
const startBtn = document.getElementById('startBtn');
const resultStartBtn = document.getElementById('resultStartBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const onlineStatusEl = document.getElementById('onlineStatus');

const firebaseConfig = {
  apiKey: "AIzaSyDwKhHV-dnFltmr1rXgLVlS9Zps0DvQpjg",
  authDomain: "mathgym-2266a.firebaseapp.com",
  databaseURL: "https://mathgym-2266a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mathgym-2266a",
  storageBucket: "mathgym-2266a.firebasestorage.app",
  messagingSenderId: "1089969116974",
  appId: "1:1089969116974:web:fe5e9dbd60e9e93f890cbf",
  measurementId: "G-EMLNYDD0RR"
};

let firebaseReady = false;
let firebaseDb = null;
let onlineMode = false;
let onlineRole = 'offline';
let onlineRoomId = '';
let onlineClientId = 'p-' + Math.random().toString(36).slice(2, 10);
let onlineSnapshotTimer = 0;
let onlineInputSentAt = 0;
let lastGuestInputPayload = '';
let guestInputState = { moveX: 0, moveY: 0, aimX: 1, aimY: 0 };
let guestLastCastNonce = 0;
let localCastNonce = 0;
let roomRefs = { room: null, state: null, input: null, cast: null, meta: null };

function setOnlineStatus(msg) {
  if (onlineStatusEl) onlineStatusEl.textContent = msg;
}

function showMenuOverlay() {
  if (menuViewEl) menuViewEl.classList.remove('hidden');
  if (resultPanelEl) resultPanelEl.classList.remove('visible');
  if (overlayEl) overlayEl.style.display = 'flex';
}

function hideOverlay() {
  if (menuViewEl) menuViewEl.classList.remove('hidden');
  if (resultPanelEl) resultPanelEl.classList.remove('visible');
  if (overlayEl) overlayEl.style.display = 'none';
}

function initFirebaseRealtime() {
  if (firebaseReady || !window.firebase) return firebaseReady;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  firebaseDb = firebase.database();
  firebaseReady = true;
  try {
    if (firebase.analytics) firebase.analytics();
  } catch (_) {
    // Analytics is optional for local/dev builds.
  }
  return true;
}

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function setInputMode(mode) {
  if (inputMode === mode) return;
  inputMode = mode;
  if (mode === 'pc') {
    controlsEl.style.display = 'none';
    pcHint.classList.add('visible');
    document.getElementById('pc-spell-bar').classList.add('visible');
    mouseCursor.classList.add('visible');
    document.body.style.cursor = 'none';
  } else {
    controlsEl.style.display = 'flex';
    pcHint.classList.remove('visible');
    document.getElementById('pc-spell-bar').classList.remove('visible');
    mouseCursor.classList.remove('visible');
    document.body.style.cursor = '';
  }
}

// Auto-detect PC on first mousemove
window.addEventListener('mousemove', () => setInputMode('pc'), { once: true });
window.addEventListener('touchstart', () => setInputMode('touch'), { once: true });

async function requestFullscreenLandscape() {
  if (!fullscreenBtn) return;
  const root = document.documentElement;
  const requestFs = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  if (!requestFs) {
    fullscreenBtn.textContent = 'Fullscreen Not Supported';
    fullscreenBtn.disabled = true;
    return;
  }

  try {
    if (!document.fullscreenElement) {
      await requestFs.call(root);
    }
    if (screen.orientation && screen.orientation.lock) {
      try {
        await screen.orientation.lock('landscape');
      } catch (_) {
        // Some mobile browsers require fullscreen first or do not allow locking.
      }
    }
    fullscreenBtn.textContent = 'Landscape Enabled';
  } catch (_) {
    fullscreenBtn.textContent = 'Tap To Retry Fullscreen';
  }
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', requestFullscreenLandscape);
  fullscreenBtn.addEventListener('touchend', e => {
    e.preventDefault();
    requestFullscreenLandscape();
  }, { passive: false });
}
if (createRoomBtn) {
  createRoomBtn.addEventListener('click', createOnlineRoom);
  createRoomBtn.addEventListener('touchend', e => {
    e.preventDefault();
    createOnlineRoom();
  }, { passive: false });
}
if (joinRoomBtn) {
  joinRoomBtn.addEventListener('click', joinOnlineRoom);
  joinRoomBtn.addEventListener('touchend', e => {
    e.preventDefault();
    joinOnlineRoom();
  }, { passive: false });
}

// ─────────────────────────────────────────────
// KEYBOARD INPUT
// ─────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Enter') {
    if (document.getElementById('overlay').style.display !== 'none') {
      startGame(e);
      return;
    }
    if (shopOpen) {
      closeShop();
      e.preventDefault();
      return;
    }
  }
  if (!gameRunning) return;
  // Dynamic: key slot index → spell from activeSpells
  const SLOT_KEYS = ['KeyQ','KeyE','KeyR','KeyT','KeyF','KeyG'];
  const slotIdx = SLOT_KEYS.indexOf(e.code);
  if (slotIdx >= 0 && players[0].activeSpells && players[0].activeSpells[slotIdx]) {
    const spellName = players[0].activeSpells[slotIdx];
    handleLocalCast(spellName);
    const btn = document.getElementById('spellbtn-'+spellName);
    if (btn) { btn.classList.add('active'); setTimeout(() => btn.classList.remove('active'), 150); }
    e.preventDefault();
  }
  if (['KeyW','KeyA','KeyS','KeyD','Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ─────────────────────────────────────────────
// MOUSE INPUT
// ─────────────────────────────────────────────
let mouseX = 0, mouseY = 0;
let camX = 0, camY = 0;  // smooth camera position (world coords)
window.addEventListener('mousemove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
  mouseCursor.style.left = mouseX + 'px';
  mouseCursor.style.top  = mouseY + 'px';
});

// Left click = fireball, Right click = lightning
window.addEventListener('mousedown', e => {
  if (!gameRunning) return;
  if (e.button === 0 && players[0].activeSpells) handleLocalCast(players[0].activeSpells[0]);
  if (e.button === 2 && players[0].activeSpells) handleLocalCast(players[0].activeSpells[1] || players[0].activeSpells[0]);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('contextmenu', e => e.preventDefault());


const stick = document.getElementById('joystick-stick');
const jzone = document.getElementById('joystick-zone');
let joystick = { active: false, dx: 0, dy: 0, id: null };
let activeSkillAim = null;
let jRect;

function getJRect() { jRect = jzone.getBoundingClientRect(); }
getJRect();
window.addEventListener('resize', getJRect);

function clearSkillAim() {
  if (activeSkillAim && activeSkillAim.button) activeSkillAim.button.classList.remove('active');
  activeSkillAim = null;
}

function updateSkillAimFromTouch(t) {
  if (!activeSkillAim) return;
  let dx = t.clientX - activeSkillAim.originX;
  let dy = t.clientY - activeSkillAim.originY;
  const dist = Math.hypot(dx, dy);
  const maxR = activeSkillAim.maxDistance;
  if (dist > maxR) {
    dx = dx / dist * maxR;
    dy = dy / dist * maxR;
  }
  const norm = Math.hypot(dx, dy) || 1;
  activeSkillAim.dx = dx / norm;
  activeSkillAim.dy = dy / norm;
  activeSkillAim.distance = Math.min(dist, maxR);
}

function beginSkillAim(btn, touch) {
  const spell = btn.dataset.spell;
  if (!players[0].activeSpells || !players[0].activeSpells.includes(spell)) return;
  const rect = btn.getBoundingClientRect();
  activeSkillAim = {
    id: touch.identifier,
    spell,
    button: btn,
    originX: rect.left + rect.width / 2,
    originY: rect.top + rect.height / 2,
    dx: Math.cos(players[0].angle),
    dy: Math.sin(players[0].angle),
    distance: 84,
    maxDistance: 132,
  };
  btn.classList.add('active');
  updateSkillAimFromTouch(touch);
}

jzone.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  joystick.active = true;
  joystick.id = t.identifier;
  updateJoystick(t);
}, { passive: false });

window.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.id) updateJoystick(t);
    if (activeSkillAim && t.identifier === activeSkillAim.id) updateSkillAimFromTouch(t);
  }
}, { passive: false });

window.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.id) {
      joystick.active = false;
      joystick.dx = 0;
      joystick.dy = 0;
      joystick.id = null;
      stick.style.transform = 'translate(-50%, -50%)';
    }
    if (activeSkillAim && t.identifier === activeSkillAim.id) {
      const aim = { dx: activeSkillAim.dx, dy: activeSkillAim.dy, distance: activeSkillAim.distance };
      const spell = activeSkillAim.spell;
      clearSkillAim();
      handleLocalCast(spell, aim);
    }
  }
});

window.addEventListener('touchcancel', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.id) {
      joystick.active = false;
      joystick.dx = 0;
      joystick.dy = 0;
      joystick.id = null;
      stick.style.transform = 'translate(-50%, -50%)';
    }
    if (activeSkillAim && t.identifier === activeSkillAim.id) clearSkillAim();
  }
});

function updateJoystick(t) {
  const cx = jRect.left + jRect.width / 2;
  const cy = jRect.top  + jRect.height / 2;
  let dx = t.clientX - cx, dy = t.clientY - cy;
  const dist = Math.hypot(dx, dy);
  const maxR = 42;
  if (dist > maxR) { dx = dx/dist*maxR; dy = dy/dist*maxR; }
  joystick.dx = dx / maxR;
  joystick.dy = dy / maxR;
  stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

document.querySelectorAll('.spell-btn').forEach(btn => {
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    beginSkillAim(btn, e.changedTouches[0]);
  }, { passive: false });
});

function computeArena() {
  arenaX = canvas.width / 2;
  arenaY = canvas.height / 2 - 30;
  arenaR = Math.min(canvas.width, canvas.height) * ARENA_RADIUS_RATIO;
}

// ─────────────────────────────────────────────
// SPAWN PLAYERS
// ─────────────────────────────────────────────
function spawnPlayers() {
  computeArena();
  const n = players.length;
  players.forEach((p, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    p.x = arenaX + Math.cos(angle) * arenaR * 0.55;
    p.y = arenaY + Math.sin(angle) * arenaR * 0.55;
    p.vx = 0; p.vy = 0;
    p.damage = 0; p.angle = angle + Math.PI;
    p.shieldActive = false; p.dead = false;
    p.hitFlash = 0; p.dashFlash = 0; p.dashTrail = []; p.hitLog = []; p.lastHitBy = -1;
    p.castFlash = 0; p.walkPhase = 0; p.deathSpin = 0;
    p.frozenUntil = 0;
    p.cooldowns = {};
  });
  projectiles = []; effects = [];
  lavaRadius = 1.0; lavaWarned = false;
  // Init camera to player 0
  camX = players[0].x; camY = players[0].y;
  const roundLabel = (round % 5 === 0 && round > 0) ? `⚔️ BOSS ROUND ${round}` : `Round ${round}`;
  document.getElementById('round-text').textContent = roundLabel;
  // Boss round every 5 rounds
  laserTelegraphs = [];
  if (round % 5 === 0 && round > 0) {
    isBossRound = true;
    spawnBoss(); // bots stay — everyone fights the boss (or each other)
  } else {
    isBossRound = false;
    bossPlayer = null;
    // Remove boss if leftover
    const bIdx = players.findIndex(p => p.isBoss);
    if (bIdx >= 0) players.splice(bIdx, 1);
  }
  // 3-2-1 countdown
  countdownVal  = 3;
  countdownTime = performance.now();
  gameRunning   = false;
  spectatorMode = false; spectatorTarget = null;
}

// ─────────────────────────────────────────────
// CAST SPELL
// ─────────────────────────────────────────────
function castSpell(p, spellName, aimOverride = null) {
  if (!gameRunning || p.dead || countdownVal > 0) return;
  const spell = getSpellForCaster(p, spellName);
  if (!spell) return;
  if (!p.isBot && p.activeSpells && !p.activeSpells.includes(spellName)) return;
  const now = performance.now();
  if ((p.cooldowns[spellName]||0) > now) return;
  p.cooldowns[spellName] = now + spell.cd;
  p.castFlash = 220;
  if (!p.isBot || Math.random() < 0.5) {
    if (SFX[spellName]) SFX[spellName]();
  }

  const enemies = players.filter(e => e.id !== p.id && !e.dead);
  if (enemies.length === 0) return;
  const target = enemies.reduce((best, e) => Math.hypot(e.x-p.x,e.y-p.y) < Math.hypot(best.x-p.x,best.y-p.y) ? e : best);
  const manualAim = aimOverride || getManualAim(p, target);
  const nx = manualAim.dx;
  const ny = manualAim.dy;

  if (spellName === 'fireball' || spellName === 'homing') {
    const shots = (spellName === 'fireball' && spell.splitShot) ? spell.splitShot : 1;
    const spread = shots > 1 ? 0.25 : 0;
    for (let si = 0; si < shots; si++) {
      const angleOffset = (si - (shots-1)/2) * spread;
      const cos0 = Math.cos(angleOffset), sin0 = Math.sin(angleOffset);
      const snx = nx*cos0 - ny*sin0, sny = nx*sin0 + ny*cos0;
      projectiles.push({
        x: p.x + snx * (p.radius + 14),
        y: p.y + sny * (p.radius + 14),
        vx: snx * spell.speed, vy: sny * spell.speed,
        owner: p.id, spell: spellName,
        damage: spell.damage, radius: spell.radius,
        color: spell.color, glow: spell.glow,
        kbMult: spell.kbMult || 1,
        pierce: spell.pierce || false,
        miniAoe: spell.miniAoe || false, miniAoeRadius: spell.miniAoeRadius || 40,
        life: 180,
      });
    }
    spawnParticlesBurst(p.x, p.y, spell.color, 6 * shots);
  }

  if (spellName === 'lightning') {
    projectiles.push({
      x: p.x + nx*(p.radius+12), y: p.y + ny*(p.radius+12),
      vx: nx * spell.speed, vy: ny * spell.speed,
      owner: p.id, spell: 'lightning',
      damage: spell.damage, radius: spell.radius || 7,
      color: spell.color, glow: spell.glow,
      range: spell.range || 280,
      distTravelled: 0,
      chainCount: spell.chainCount || 0,
      chainHit: [],
      fork: spell.fork || false,
      stunDur: spell.stunDur || 0,
      stormAoe: spell.stormAoe || false,
      stormRadius: spell.stormRadius || 0,
      life: 120,
    });
    spawnParticlesBurst(p.x, p.y, spell.color, 8);
  }

  if (spellName === 'shield') {
    p.shieldActive = true;
    p.shieldTimer = performance.now() + spell.duration;
  }

  if (spellName === 'thrust') {
    p.vx += nx * spell.dashSpeed;
    p.vy += ny * spell.dashSpeed;
    p.thrusting = true;
    p.thrustTimer = performance.now() + 300;
    p.dashFlash = 400;
    p.dashTrail = [];
    spawnParticlesBurst(p.x, p.y, spell.color, 14);
  }

  if (spellName === 'meteor') {
    projectiles.push({
      x: p.x + nx*(p.radius+18), y: p.y + ny*(p.radius+18),
      vx: nx*spell.speed, vy: ny*spell.speed,
      owner: p.id, spell: 'meteor',
      damage: spell.damage, radius: spell.radius,
      color: spell.color, glow: spell.glow,
      aoe: true, aoeRadius: spell.aoeRadius,
      life: 220,
    });
    spawnParticlesBurst(p.x, p.y, spell.color, 18);
  }

  if (spellName === 'icebolt') {
    projectiles.push({
      x: p.x + nx*(p.radius+12), y: p.y + ny*(p.radius+12),
      vx: nx*spell.speed, vy: ny*spell.speed,
      owner: p.id, spell: 'icebolt',
      damage: spell.damage, radius: spell.radius,
      color: spell.color, glow: spell.glow,
      freeze: true, freezeDur: spell.freezeDur,
      life: 200,
    });
    spawnParticlesBurst(p.x, p.y, spell.color, 8);
  }

  if (spellName === 'gravity') {
    const gravityRange = 220;
    const gravityDist = Math.min(manualAim.distance || gravityRange, gravityRange);
    const cx = p.x + nx * gravityDist;
    const cy = p.y + ny * gravityDist;
    effects.push({ type: 'gravity', x: cx, y: cy, life: spell.duration / 16, maxLife: spell.duration / 16, radius: spell.radius, color: spell.color });
    players.forEach(ep => {
      if (ep.id === p.id || ep.dead) return;
      const tdx = cx - ep.x, tdy = cy - ep.y;
      const td = Math.hypot(tdx, tdy) || 1;
      if (td <= spell.radius * 1.8) {
        ep.vx += (tdx/td) * 4;
        ep.vy += (tdy/td) * 4;
      }
    });
    spawnParticlesBurst(cx, cy, spell.color, 16);
  }
}

function applyDamage(victim, attacker, dmg, nx, ny, kbMult) {
  if (victim.isBoss) {
    victim.bossHp = Math.max(0, (victim.bossHp||0) - dmg);
    victim.hitFlash = 300;
    victim.lastHitBy = attacker.id;
    showDmgNumber(victim.x, victim.y - victim.radius, dmg, '#ff8888');
    checkBossDead(victim);
    return; // boss knockback is ignored
  }
  victim.damage += dmg;
  victim.hitFlash = 500;
  SFX.hit(victim.id === 0);
  // Record hit for kill/assist tracking
  const hitTime = performance.now();
  victim.hitLog = (victim.hitLog||[]).filter(h => hitTime - h.time < 2000); // keep last 2s
  victim.hitLog.push({ attackerId: attacker.id, time: hitTime });
  victim.lastHitBy = attacker.id;
  const kb = (1.5 + victim.damage / 40) * (dmg / 18) * (kbMult || 1);
  victim.vx += nx * kb * 3;
  victim.vy += ny * kb * 3;
  showDmgNumber(victim.x, victim.y, dmg, victim.color);
}

function showDmgNumber(x, y, val, color) {
  if (lowFxMode && particles.length >= MAX_PARTICLES) return;
  particles.push({ type: 'text', x, y, vy: -1.5, text: `+${val}`, color, life: 50, maxLife: 50 });
}
function showGoldPop(x, y, msg) {
  if (lowFxMode && particles.length >= MAX_PARTICLES) return;
  particles.push({ type: 'text', x, y, vy: -1.2, text: msg, color: '#ffd700', life: 80, maxLife: 80 });
}

// ─────────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────────
function spawnParticlesBurst(x, y, color, count) {
  if (particles.length >= MAX_PARTICLES) return;
  const burstCount = Math.min(
    lowFxMode ? Math.max(2, Math.ceil(count * 0.4)) : count,
    MAX_PARTICLES - particles.length
  );
  for (let i = 0; i < burstCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 3;
    particles.push({ type: 'dot', x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, color, radius: 2 + Math.random()*3, life: 30 + Math.random()*30, maxLife: 60 });
  }
}

// ─────────────────────────────────────────────
// HUD UPDATE
// ─────────────────────────────────────────────

// ── PC Spell Bar ──
const PC_KEY_MAP = ['Q','E','R','T','F','G'];

// Inline mini-SVGs for pc bar (reuse defs already on page won't work cross-context, so just reference the spell-btn SVG innerHTML)
function updatePCSpellBar() {
  const bar = document.getElementById('pc-spell-bar');
  if (!bar || inputMode !== 'pc') { if(bar) bar.classList.remove('visible'); return; }
  bar.classList.add('visible');

  const p = players[0];
  const spells = p.activeSpells || [];
  const now = performance.now();

  const RING_COLORS = { fireball:'#ff6b35', lightning:'#ffd700', homing:'#4fc3f7',
    shield:'#81c784', thrust:'#ce93d8', gravity:'#b0bec5', meteor:'#ff4400', icebolt:'#a8e6ff' };
  const CIRCUM = 150.8; // 2*PI*24

  bar.innerHTML = spells.slice(0,6).map((sp, i) => {
    const key  = PC_KEY_MAP[i] || '?';
    const cd   = SPELLS[sp] ? SPELLS[sp].cd : 1000;
    const rem  = Math.max(0, (p.cooldowns[sp]||0) - now);
    const pct  = rem / cd;
    const onCd = pct > 0.01;
    const col  = RING_COLORS[sp] || '#fff';
    const dashOff = (1-pct) * CIRCUM;
    const lvl  = p.spellLevels && p.spellLevels[sp] ? p.spellLevels[sp] : (sp==='fireball'||sp==='thrust'?1:null);

    // Grab SVG from existing spell button (clone inner SVG)
    const srcBtn = document.getElementById('spellbtn-'+sp);
    let iconHTML = `<div style="width:48px;height:48px;border-radius:50%;background:rgba(30,20,50,0.8);display:flex;align-items:center;justify-content:center;font-size:22px;">${{fireball:'🔥',lightning:'⚡',homing:'💙',shield:'🛡️',thrust:'💨',gravity:'🌀',meteor:'☄️',icebolt:'🧊'}[sp]||'✨'}</div>`;
    if (srcBtn) {
      const svgEl = srcBtn.querySelector('svg:first-of-type');
      if (svgEl) {
        const clone = svgEl.cloneNode(true);
        clone.style.cssText = 'width:48px;height:48px;display:block;border-radius:50%;';
        if (onCd) { const ib = clone.querySelector('.spell-icon-bg'); if(ib) ib.style.filter='saturate(0) brightness(0.4)'; }
        else { const ib = clone.querySelector('.spell-icon-bg'); if(ib) ib.style.filter=''; }
        iconHTML = clone.outerHTML;
      }
    }

    return `<div class="pc-spell-slot">
      <div class="pc-icon-wrap">
        ${iconHTML}
        <svg viewBox="0 0 48 48" style="position:absolute;top:0;left:0;width:48px;height:48px;pointer-events:none;" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="21" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"/>
          ${onCd ? `<circle cx="24" cy="24" r="21" fill="none" stroke="${col}" stroke-width="3"
            stroke-dasharray="${CIRCUM}" stroke-dashoffset="${dashOff.toFixed(1)}"
            stroke-linecap="round" transform="rotate(-90,24,24)"/>` : ''}
        </svg>
        ${onCd ? `<span class="pc-cd-text">${(rem/1000).toFixed(1)}</span>` : ''}
        ${lvl ? `<span class="pc-level-badge">Lv${lvl}</span>` : ''}
      </div>
      <span class="pc-key">${key}</span>
    </div>`;
  }).join('');
}

function updateHUD() {
  const now = performance.now();
  // Update player lives HUD
  const p0 = players[0];
  const livesEl = document.getElementById('p1-lives');
  if (livesEl) livesEl.innerHTML = Array.from({length: MAX_LIVES}, (_,j) =>
    `<div class="life-dot ${j < p0.lives ? 'p1' : 'empty'}"></div>`
  ).join('');
  const dmgBar = document.getElementById('p1-dmgbar');
  if (dmgBar) dmgBar.style.width = Math.min(100, p0.damage/1.5) + '%';

  // Gold display
  const goldEl = document.getElementById('gold-display');
  if (goldEl) goldEl.textContent = `💰 ${playerGold}g`;

  // Mini bot status in top-right
  const botsHud = document.getElementById('bots-hud');
  if (botsHud) {
    botsHud.innerHTML = players.filter(p=>p.isBot).map(p=>`
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;opacity:${p.dead&&p.lives<=0?0.3:1}">
        <div style="width:8px;height:8px;border-radius:50%;background:${p.color};box-shadow:0 0 5px ${p.color};opacity:${p.dead?0.3:1}"></div>
        <div style="display:flex;gap:2px">${Array.from({length:MAX_LIVES},(_,j)=>`<div style="width:5px;height:5px;border-radius:50%;background:${j<p.lives?p.color:'rgba(255,255,255,0.1)'}"></div>`).join('')}</div>
      </div>
    `).join('');
  }

  // ── SVG ring cooldown system ──
  const SPELL_RING_COLORS = {
    fireball:'#ff6b35', lightning:'#ffd700', homing:'#4fc3f7',
    shield:'#81c784',   thrust:'#ce93d8',    gravity:'#b0bec5',
    meteor:'#ff4400',   icebolt:'#a8e6ff'
  };
  const CIRCUMFERENCE = 188.5; // 2*PI*30
  const allSpells = ['fireball','lightning','homing','shield','thrust','gravity','meteor','icebolt'];

  // Update PC spell bar
  updatePCSpellBar();

  allSpells.forEach(s => {
    const btn  = document.getElementById('spellbtn-'+s);
    const ring = document.getElementById('cdring-'+s);
    const num  = document.getElementById('cdnum-'+s);
    if (!btn) return;

    const isOwned = p0.activeSpells && p0.activeSpells.includes(s);
    if (!isOwned) { btn.style.display = 'none'; return; }
    btn.style.display = '';

    const cd = SPELLS[s] ? SPELLS[s].cd : 1000;
    const remaining = Math.max(0, (p0.cooldowns[s]||0) - now);
    const pct = remaining / cd;

    // Greyscale when on CD
    const iconBg = btn.querySelector('.spell-icon-bg');
    if (iconBg) {
      iconBg.style.filter = pct > 0.01 ? 'saturate(0) brightness(0.4)' : '';
    }

    // Ring sweep
    if (ring) {
      if (pct > 0.01) {
        ring.style.display = '';
        ring.setAttribute('stroke', SPELL_RING_COLORS[s] || '#ffffff');
        // starts full (0) drains to empty (CIRCUMFERENCE) as pct goes 1->0
        // pct=1 means just cast (full ring), pct=0 means ready (no ring)
        ring.setAttribute('stroke-dashoffset', ((1 - pct) * CIRCUMFERENCE).toFixed(2));
      } else {
        ring.style.display = 'none';
      }
    }

    if (num) num.textContent = pct > 0.01 ? (remaining/1000).toFixed(1) : '';
    // Ready glow class
    if (pct <= 0.01) { btn.classList.add('ready'); btn.classList.remove('on-cd'); }
    else             { btn.classList.remove('ready'); btn.classList.add('on-cd'); }
  });
}

// ─────────────────────────────────────────────
// BOT AI
// ─────────────────────────────────────────────
function updateBot(bot, dt) {
  const now = performance.now();
  if (bot.dead) return;
  if (bot.frozenUntil && performance.now() < bot.frozenUntil) return; // frozen
  // Pick nearest live enemy
  const enemies = players.filter(e => e.id !== bot.id && !e.dead);
  if (enemies.length === 0) return;
  const target = enemies.reduce((best, e) =>
    Math.hypot(e.x-bot.x,e.y-bot.y) < Math.hypot(best.x-bot.x,best.y-bot.y) ? e : best
  );

  // Move toward target with some jitter
  bot.botActionTimer -= dt;
  if (bot.botActionTimer <= 0) {
    bot.botActionTimer = 400 + Math.random() * 600;
    const dx = target.x - bot.x, dy = target.y - bot.y;
    const dist = Math.hypot(dx, dy);
    const desiredDist = 80 + Math.random() * 60;
    if (dist > desiredDist) {
      bot.vx += (dx/dist) * 1.2;
      bot.vy += (dy/dist) * 1.2;
    } else if (dist < desiredDist - 20) {
      bot.vx -= (dx/dist) * 0.8;
      bot.vy -= (dy/dist) * 0.8;
    }
    // Stay near arena center
    const adx = arenaX - bot.x, ady = arenaY - bot.y;
    const adist = Math.hypot(adx, ady);
    if (adist > arenaR * 0.6) {
      bot.vx += (adx/adist) * 0.8;
      bot.vy += (ady/adist) * 0.8;
    }
  }

  // Cast spells
  bot.botSpellTimer -= dt;
  if (bot.botSpellTimer <= 0) {
    bot.botSpellTimer = 800 + Math.random() * 1200;
    const spellList = (bot.activeSpells || ['fireball','lightning','thrust']).filter(s => s !== 'shield');
    const available = spellList.filter(s => (bot.cooldowns[s] || 0) <= now);
    if (available.length > 0) {
      const spell = available[Math.floor(Math.random() * available.length)];
      castSpell(bot, spell);
    }
    // Shield if low
    if (bot.damage > 60 && (bot.activeSpells||[]).includes('shield') && (!bot.cooldowns.shield || bot.cooldowns.shield <= now) && Math.random() < 0.4) {
      castSpell(bot, 'shield');
    }
  }
}

// ─────────────────────────────────────────────
// PHYSICS UPDATE
// ─────────────────────────────────────────────
function updatePhysics(now, dt) {
  // Shrink arena: shrinks by a fixed step every 5 seconds
  if (lavaRadius > 0.45 && gameRunning) {
    if (now - lavaLastTime >= 5000) {
      lavaRadius = Math.max(0.45, lavaRadius - 0.05);
      lavaLastTime = now;
      SFX.lavaShrink();
    }
  }
  players.forEach(p => {
    if (p.dead) {
      p.deadTimer -= dt;
      p.deathSpin += 0.15;
      if (p.deadTimer <= 1200 && !roundEndPending && !onlineMode) checkRoundEnd();
      return;
    }

    // Player movement
    if (!p.isBot) {
      const speed = 0.55;
      if (onlineMode && onlineRole === 'host' && p.id === 1) {
        p.vx += (guestInputState.moveX || 0) * speed;
        p.vy += (guestInputState.moveY || 0) * speed;
        if (guestInputState.aimX || guestInputState.aimY) {
          p.angle = Math.atan2(guestInputState.aimY || 0, guestInputState.aimX || 1);
        }
      } else if (inputMode === 'pc') {
        // WASD keyboard
        if (keys['KeyW'] || keys['ArrowUp'])    { p.vy -= speed; }
        if (keys['KeyS'] || keys['ArrowDown'])  { p.vy += speed; }
        if (keys['KeyA'] || keys['ArrowLeft'])  { p.vx -= speed; }
        if (keys['KeyD'] || keys['ArrowRight']) { p.vx += speed; }
        // Mouse aim
        const wmx = mouseX + camX - canvas.width/2;
        const wmy = mouseY + camY - canvas.height/2;
        p.angle = Math.atan2(wmy - p.y, wmx - p.x);
      } else {
        if (joystick.active) {
          p.vx += joystick.dx * speed;
          p.vy += joystick.dy * speed;
          // Face movement direction
          if (Math.abs(joystick.dx) > 0.1 || Math.abs(joystick.dy) > 0.1) {
            p.angle = Math.atan2(joystick.dy, joystick.dx);
          }
        }
      }
    }

    // Face nearest enemy
    if (p.isBot) {
      const enemies2 = players.filter(e => e.id !== p.id && !e.dead);
      if (enemies2.length > 0) {
        const t = enemies2.reduce((best,e) => Math.hypot(e.x-p.x,e.y-p.y)<Math.hypot(best.x-p.x,best.y-p.y)?e:best);
        p.angle = Math.atan2(t.y - p.y, t.x - p.x);
      }
    } else {
      if (onlineMode && onlineRole === 'host' && p.id === 1) {
        p.angle = Math.atan2(guestInputState.aimY || 0, guestInputState.aimX || 1);
      } else if (inputMode === 'pc') {
        const wmx = mouseX + camX - canvas.width/2;
        const wmy = mouseY + camY - canvas.height/2;
        p.angle = Math.atan2(wmy - p.y, wmx - p.x);
      } else {
        const nearestEnemy = players.filter(e => !e.dead && e.id !== 0)
          .reduce((best, e) => !best || Math.hypot(e.x-p.x,e.y-p.y)<Math.hypot(best.x-p.x,best.y-p.y)?e:best, null);
        if (nearestEnemy) p.angle = Math.atan2(nearestEnemy.y - p.y, nearestEnemy.x - p.x);
      }
    }

    // Freeze check
    const frozen = p.frozenUntil && performance.now() < p.frozenUntil;
    if (frozen) { p.vx *= 0.4; p.vy *= 0.4; }

    // Friction
    p.vx *= 0.82; p.vy *= 0.82;
    p.x += p.vx; p.y += p.vy;

    // Animation phases
    const spd = Math.hypot(p.vx, p.vy);
    p.isMoving = spd > 0.25;
    if (p.isMoving) p.walkPhase += spd * 0.28;
    p.idlePhase += 0.022;
    if (p.castFlash > 0) p.castFlash -= dt;
    if (p.hitFlash > 0) p.hitFlash -= dt;
    if (p.dashFlash > 0) p.dashFlash -= dt;

    // Dash trail: record ghost positions while thrusting
    if (p.thrusting) {
      p.dashTrail.unshift({ x: p.x, y: p.y, angle: p.angle, life: 1.0 });
      if (p.dashTrail.length > 10) p.dashTrail.length = 10;
    }
    // Fade existing trail frames
    p.dashTrail = (p.dashTrail || []).map(t => ({ ...t, life: t.life - 0.08 })).filter(t => t.life > 0);

    // Shield timer
    if (p.shieldActive && now > p.shieldTimer) p.shieldActive = false;
    if (p.thrusting && now > p.thrustTimer) p.thrusting = false;

    // Check lava death
    const dist = Math.hypot(p.x - arenaX, p.y - arenaY);
    if (dist > arenaR * lavaRadius - p.radius) {
      // Die
      p.lives--;
      p.dead = true;
      p.deadTimer = 2000;
      SFX.death(p.id === 0);
      spawnParticlesBurst(p.x, p.y, p.color, 30);
      // Kill gold: last hit attacker
      awardKillGold(p);
      // Reset all surviving players' damage accumulation on the dead one
      // (damage to dead player resets next spawn)
    }
  });

  // Projectiles
  projectiles.forEach(proj => {
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.life--;

    if (proj.spell === 'homing') {
      const t = proj.owner === 0 ? players[1] : players[0];
      if (!t.dead) {
        const dx = t.x - proj.x, dy = t.y - proj.y;
        const d = Math.hypot(dx, dy) || 1;
        proj.vx += (dx/d) * 0.15;
        proj.vy += (dy/d) * 0.15;
        const spd = Math.hypot(proj.vx, proj.vy);
        if (spd > SPELLS.homing.speed) {
          proj.vx = proj.vx/spd*SPELLS.homing.speed;
          proj.vy = proj.vy/spd*SPELLS.homing.speed;
        }
      }
    }

    if (proj.distTravelled !== undefined) {
      const spd = Math.hypot(proj.vx, proj.vy);
      proj.distTravelled += spd;
      if (proj.range && proj.distTravelled > proj.range) proj.life = -1;
    }
    if (Math.hypot(proj.x - arenaX, proj.y - arenaY) > arenaR * lavaRadius + 20) proj.life = -1;
  });

  for (let i = 0; i < projectiles.length; i++) {
    const a = projectiles[i];
    if (a.life <= 0 || a.spell !== 'fireball') continue;
    for (let j = i + 1; j < projectiles.length; j++) {
      const b = projectiles[j];
      if (b.life <= 0 || b.spell !== 'fireball' || a.owner === b.owner) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const minDist = (a.radius || 0) + (b.radius || 0);
      if (dx*dx + dy*dy <= minDist * minDist) {
        a.life = -1;
        b.life = -1;
        const ex = (a.x + b.x) * 0.5;
        const ey = (a.y + b.y) * 0.5;
        spawnParticlesBurst(ex, ey, '#ff8844', 18);
        effects.push({ type:'explosion', x:ex, y:ey, radius:34, life:12, maxLife:12, color:'#ff6b35' });
        break;
      }
    }
  }

  projectiles.forEach(proj => {
    if (proj.life <= 0) return;
    players.forEach(p => {
      if (p.id === proj.owner || p.dead || proj.life <= 0) return;
      const dx = p.x - proj.x, dy = p.y - proj.y;
      if (Math.hypot(dx, dy) < p.radius + proj.radius) {
        if (p.shieldActive) {
          proj.vx *= -1; proj.vy *= -1; proj.owner = p.id;
          spawnParticlesBurst(proj.x, proj.y, '#81c784', 8);
        } else {
          const nd = Math.hypot(dx, dy) || 1;
          const attacker = players.find(o => o.id === proj.owner);
          applyDamage(p, attacker, proj.damage, dx/nd, dy/nd);
          if (proj.freeze) p.frozenUntil = performance.now() + (proj.freezeDur||800);
          if (proj.aoe) {
            spawnParticlesBurst(proj.x, proj.y, proj.color, 35);
            effects.push({ type:'explosion', x:proj.x, y:proj.y, radius:proj.aoeRadius, life:18, maxLife:18, color:proj.color });
            players.forEach(ep => {
              if (ep.id === proj.owner || ep.dead || ep.id === p.id) return;
              const ed = Math.hypot(ep.x-proj.x, ep.y-proj.y);
              if (ed < proj.aoeRadius) {
                const enx = (ep.x-proj.x)/ed||1, eny = (ep.y-proj.y)/ed||1;
                applyDamage(ep, attacker, proj.damage*0.6, enx, eny);
              }
            });
          } else {
            spawnParticlesBurst(proj.x, proj.y, proj.color, 10);
          }
          proj.life = -1;
        }
      }
    });
  });

  projectiles = projectiles.filter(proj => proj.life > 0);

  // Particles
  particles = particles.filter(pt => {
    pt.life--;
    if (pt.vy !== undefined) { pt.x += pt.vx || 0; pt.y += pt.vy; }
    return pt.life > 0;
  });
  if (particles.length > MAX_PARTICLES) {
    particles.splice(0, particles.length - MAX_PARTICLES);
  }

  // Effects
  effects = effects.filter(e => { e.life--; return e.life > 0; });

  if (onlineMode && onlineRole === 'host' && !roundEndPending) {
    const loser = players.slice(0, 2).find(p => p.dead);
    if (loser) {
      roundEndPending = true;
      gameRunning = false;
      if (roomRefs.meta) roomRefs.meta.update({ status: 'finished', winner: loser.id === 0 ? 1 : 0 });
      setTimeout(() => presentGameOver(loser.id !== 0), 500);
    }
  }
}

// ─────────────────────────────────────────────
// CHECK ROUND / GAME END
// ─────────────────────────────────────────────
let roundEndPending = false;


// ─────────────────────────────────────────────
// BOSS
// ─────────────────────────────────────────────
function makeBoss() {
  const b = makePlayer(99, 'BOSS', '#cc0044', '#ff0066', true);
  b.isBoss    = true;
  b.radius    = 36;        // much bigger
  b.lives     = 1;
  b.damage    = 0;         // needs a LOT of damage to die (override lava check)
  b.bossHp    = 500;       // custom HP bar
  b.bossMaxHp = 500;
  b.laserTimer     = 0;    // countdown to next laser
  b.laserCharging  = false;
  b.laserChargeTimer = 0;
  b.missileTimer   = 0;
  b.rageMode       = false;
  b.rageTelegraphing = false;
  b.rageTelegraphTimer = 0;
  b.rageLaserTimer = 0;
  b.rageSweepActive = false;
  b.rageSweepAngle = 0;
  b.rageSweepStart = 0;
  b.rageSweepEnd = 0;
  b.rageSweepSpeed = 0;
  b.activeSpells   = ['fireball','meteor','lightning'];
  b.spellLevels    = {};
  return b;
}

function getSpellForCaster(p, spellName) {
  const base = SPELLS[spellName];
  if (!base) return null;
  if (!p.isBot) return base;

  const spell = { ...base };
  const lvl = (p.spellLevels && p.spellLevels[spellName]) || 1;

  if (spellName === 'fireball') {
    for (let i = 2; i <= lvl && i < FIREBALL_LEVELS.length; i++) {
      const tier = FIREBALL_LEVELS[i];
      if (tier && tier.fn) tier.fn(spell);
    }
  }
  if (spellName === 'lightning') {
    for (let i = 2; i <= lvl && i < LIGHTNING_LEVELS.length; i++) {
      const tier = LIGHTNING_LEVELS[i];
      if (tier && tier.fn) tier.fn(spell);
    }
  }

  if (p.upgrades) {
    if (p.upgrades.upg_fireball && spellName === 'fireball') {
      spell.damage += 12;
      spell.cd = Math.round(spell.cd * 0.8);
    }
    if (p.upgrades.upg_lightning && spellName === 'lightning') {
      spell.damage += 20;
      spell.cd = Math.round(spell.cd * 0.8);
    }
    if (p.upgrades.upg_homing && spellName === 'homing') {
      spell.damage += 15;
      spell.cd = Math.round(spell.cd * 0.8);
    }
    if (p.upgrades.upg_thrust && spellName === 'thrust') {
      spell.dashSpeed *= 1.5;
    }
    if (p.upgrades.upg_shield && spellName === 'shield') {
      spell.duration += 1500;
    }
    if (p.upgrades.upg_speed && ['fireball','homing','meteor','icebolt'].includes(spellName) && spell.speed) {
      spell.speed *= 1.3;
    }
  }

  return spell;
}

function getManualAim(p, fallbackTarget) {
  let ax = 0;
  let ay = 0;
  if (!p.isBot && inputMode === 'pc') {
    ax = mouseX + camX - canvas.width / 2 - p.x;
    ay = mouseY + camY - canvas.height / 2 - p.y;
  } else if (!p.isBot) {
    ax = Math.cos(p.angle);
    ay = Math.sin(p.angle);
  } else if (fallbackTarget) {
    ax = fallbackTarget.x - p.x;
    ay = fallbackTarget.y - p.y;
  }
  const dist = Math.hypot(ax, ay) || 1;
  return { dx: ax / dist, dy: ay / dist, distance: dist };
}

function resetOnlineRoomRefs() {
  Object.values(roomRefs).forEach(ref => { if (ref && ref.off) ref.off(); });
  roomRefs = { room: null, state: null, input: null, cast: null, meta: null };
  guestInputState = { moveX: 0, moveY: 0, aimX: 1, aimY: 0 };
  onlineSnapshotTimer = 0;
  onlineInputSentAt = 0;
  lastGuestInputPayload = '';
}

function configureOnlinePlayers() {
  players.splice(2);
  players[0].name = 'You';
  players[1].name = 'Opponent';
  players[0].isBot = false;
  players[1].isBot = false;
  players.forEach(p => {
    p.lives = 1;
    p.activeSpells = ['fireball','lightning','homing','shield','thrust','gravity'];
    p.upgrades = {};
    p.spellLevels = {};
    p.cooldowns = {};
    p.gold = 0;
    p.dead = false;
    p.deadTimer = 0;
    p.damage = 0;
    p.shieldActive = false;
    p.thrusting = false;
  });
  projectiles = [];
  effects = [];
  particles = [];
  lavaRadius = 1.0;
  lavaWarned = false;
  round = 1;
  isBossRound = false;
  bossPlayer = null;
  spawnPlayers();
  countdownVal = -1;
  gameRunning = true;
  roundEndPending = false;
  guestLastCastNonce = 0;
  localCastNonce = 0;
  hideOverlay();
}

function serializeOnlineState() {
  return {
    players: players.slice(0, 2).map(p => ({ ...p })),
    projectiles: projectiles.map(p => ({ ...p })),
    effects: effects.map(e => ({ ...e })),
    round,
    lavaRadius,
    gameRunning,
  };
}

function applyOnlineSnapshot(snapshot) {
  if (!snapshot || !snapshot.players || snapshot.players.length < 2) return;
  const ordered = onlineRole === 'guest'
    ? [snapshot.players[1], snapshot.players[0]]
    : snapshot.players;
  players.splice(0, players.length, ...ordered.map((p, idx) => ({
    ...p,
    name: idx === 0 ? 'You' : 'Opponent',
    isBot: false,
  })));
  projectiles = (snapshot.projectiles || []).map(p => ({ ...p }));
  effects = (snapshot.effects || []).map(e => ({ ...e }));
  round = snapshot.round || 1;
  lavaRadius = snapshot.lavaRadius || 1;
  gameRunning = !!snapshot.gameRunning;
  isBossRound = false;
  bossPlayer = null;
}

function sendGuestInput() {
  if (!onlineMode || onlineRole !== 'guest' || !roomRefs.input || !players[0]) return;
  let moveX = 0, moveY = 0, aimX = Math.cos(players[0].angle), aimY = Math.sin(players[0].angle);
  if (inputMode === 'pc') {
    if (keys['KeyW'] || keys['ArrowUp']) moveY -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) moveY += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) moveX -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;
    const len = Math.hypot(moveX, moveY) || 1;
    moveX /= len; moveY /= len;
    const aim = getManualAim(players[0], players[1] || players[0]);
    aimX = aim.dx; aimY = aim.dy;
  } else {
    moveX = joystick.dx;
    moveY = joystick.dy;
    if (activeSkillAim) {
      aimX = activeSkillAim.dx;
      aimY = activeSkillAim.dy;
    }
  }
  const payload = {
    moveX: Math.round(moveX * 1000) / 1000,
    moveY: Math.round(moveY * 1000) / 1000,
    aimX: Math.round(aimX * 1000) / 1000,
    aimY: Math.round(aimY * 1000) / 1000,
  };
  const payloadKey = `${payload.moveX}|${payload.moveY}|${payload.aimX}|${payload.aimY}`;
  const now = performance.now();
  if (payloadKey === lastGuestInputPayload && now - onlineInputSentAt < 33) return;
  lastGuestInputPayload = payloadKey;
  onlineInputSentAt = now;
  roomRefs.input.set(payload);
}

function sendGuestCast(spellName, aim) {
  if (!onlineMode || onlineRole !== 'guest' || !roomRefs.cast) return;
  localCastNonce += 1;
  roomRefs.cast.set({
    nonce: localCastNonce,
    spell: spellName,
    aim,
  });
}

function handleLocalCast(spellName, aim = null) {
  if (onlineMode && onlineRole === 'guest') {
    sendGuestCast(spellName, aim || getManualAim(players[0], players[1] || players[0]));
    return;
  }
  castSpell(players[0], spellName, aim);
}

function createOnlineRoom() {
  if (!initFirebaseRealtime()) {
    setOnlineStatus('Firebase failed to initialize.');
    return;
  }
  resetOnlineRoomRefs();
  onlineRoomId = makeRoomCode();
  onlineRole = 'host';
  onlineMode = true;
  roomRefs.room = firebaseDb.ref('rooms/' + onlineRoomId);
  roomRefs.meta = roomRefs.room.child('meta');
  roomRefs.state = roomRefs.room.child('state');
  roomRefs.input = roomRefs.room.child('guestInput');
  roomRefs.cast = roomRefs.room.child('guestCast');
  roomRefs.room.onDisconnect().remove();
  roomRefs.meta.set({ hostId: onlineClientId, guestId: '', status: 'waiting' });
  roomRefs.input.on('value', snap => { guestInputState = snap.val() || guestInputState; });
  roomRefs.cast.on('value', snap => {
    const data = snap.val();
    if (!data || !players[1] || data.nonce <= guestLastCastNonce) return;
    guestLastCastNonce = data.nonce;
    castSpell(players[1], data.spell, data.aim || null);
  });
  roomRefs.meta.on('value', snap => {
    const meta = snap.val();
    if (!meta) return;
    if (meta.status === 'finished') {
      onlineMode = false;
      onlineRole = 'offline';
      resetOnlineRoomRefs();
      presentGameOver(meta.winner === 0);
      return;
    }
    if (meta.guestId && meta.status !== 'started') {
      configureOnlinePlayers();
      roomRefs.meta.update({ status: 'started' });
      roomRefs.state.set(serializeOnlineState());
      setOnlineStatus('Guest connected. Match live in room ' + onlineRoomId + '.');
    } else if (!meta.guestId) {
      setOnlineStatus('Room ' + onlineRoomId + ' created. Share the code and wait.');
    }
  });
}

function joinOnlineRoom() {
  if (!initFirebaseRealtime()) {
    setOnlineStatus('Firebase failed to initialize.');
    return;
  }
  const code = (roomCodeInput.value || '').trim().toUpperCase();
  if (!code) {
    setOnlineStatus('Enter a room code first.');
    return;
  }
  resetOnlineRoomRefs();
  onlineRoomId = code;
  onlineRole = 'guest';
  onlineMode = true;
  roomRefs.room = firebaseDb.ref('rooms/' + onlineRoomId);
  roomRefs.meta = roomRefs.room.child('meta');
  roomRefs.state = roomRefs.room.child('state');
  roomRefs.input = roomRefs.room.child('guestInput');
  roomRefs.cast = roomRefs.room.child('guestCast');
  roomRefs.input.onDisconnect().remove();
  roomRefs.cast.onDisconnect().remove();
  roomRefs.meta.child('guestId').onDisconnect().remove();
  roomRefs.meta.once('value').then(snap => {
    const meta = snap.val();
    if (!meta) {
      setOnlineStatus('Room not found.');
      onlineMode = false;
      onlineRole = 'offline';
      resetOnlineRoomRefs();
      return;
    }
    if (meta.guestId && meta.guestId !== onlineClientId) {
      setOnlineStatus('Room already full.');
      onlineMode = false;
      onlineRole = 'offline';
      resetOnlineRoomRefs();
      return;
    }
    roomRefs.meta.update({ guestId: onlineClientId });
    hideOverlay();
    setOnlineStatus('Connected. Waiting for host state...');
  }).catch(() => {
    setOnlineStatus('Failed to join room.');
    onlineMode = false;
    onlineRole = 'offline';
    resetOnlineRoomRefs();
  });
  roomRefs.state.on('value', snap => {
    const state = snap.val();
    if (state) applyOnlineSnapshot(state);
  });
  roomRefs.meta.on('value', snap => {
    const meta = snap.val();
    if (!meta) return;
    if (meta.status === 'finished') {
      onlineMode = false;
      onlineRole = 'offline';
      resetOnlineRoomRefs();
      presentGameOver(meta.winner === 1);
    }
  });
}

function spawnBoss() {
  computeArena();
  // Remove existing boss if any
  const bIdx = players.findIndex(p => p.isBoss);
  if (bIdx >= 0) players.splice(bIdx, 1);
  const boss = makeBoss();
  boss.x = arenaX;
  boss.y = arenaY - arenaR * 0.3;
  bossPlayer = boss;
  players.push(boss);
}

function startBossRageTelegraph(boss, target) {
  const baseAngle = Math.atan2(target.y - boss.y, target.x - boss.x);
  const range = arenaR * 1.3;
  boss.rageTelegraphing = true;
  boss.rageTelegraphTimer = 1500;
  boss.rageSweepActive = false;
  boss.rageSweepStart = baseAngle - Math.PI * 0.75;
  boss.rageSweepEnd = boss.rageSweepStart + Math.PI * 1.5;
  boss.rageSweepAngle = boss.rageSweepStart;
  boss.rageSweepSpeed = (Math.PI * 1.5) / 5000;
  clearLaserTelegraphs('rage-sweep');
  laserTelegraphs.push({
    kind: 'rage-sweep',
    cx: boss.x,
    cy: boss.y,
    radius: range,
    startAngle: boss.rageSweepStart,
    endAngle: boss.rageSweepEnd,
    timer: boss.rageTelegraphTimer,
    maxTimer: boss.rageTelegraphTimer,
    width: 120,
  });
  laserTelegraphs.push({
    kind: 'rage-sweep',
    x1: boss.x,
    y1: boss.y,
    x2: boss.x + Math.cos(boss.rageSweepStart) * range,
    y2: boss.y + Math.sin(boss.rageSweepStart) * range,
    timer: boss.rageTelegraphTimer,
    maxTimer: boss.rageTelegraphTimer,
    width: 120,
  });
  screenShake = Math.max(screenShake, 8);
}

function finishBossRound(playerWon) {
  if (roundEndPending) return;
  roundEndPending = true;
  spectatorMode = false;
  spectatorTarget = null;
  gameRunning = false;
  clearLaserTelegraphs();

  if (playerWon) {
    playerGold += 20;
    if (!players[0].dead) showGoldPop(players[0].x, players[0].y - 30, '+20g STAGE CLEAR! ðŸ†');
  } else {
    if (bossPlayer && !bossPlayer.dead) {
      bossPlayer.dead = true;
      bossPlayer.deadTimer = 1200;
      bossPlayer.deathSpin = 0;
    }
    showGoldPop(arenaX, arenaY - arenaR * 0.72, 'BOSS STAGE FAILED');
  }

  awardBotsRoundGold(20);

  round++;
  setTimeout(() => {
    isBossRound = false;
    bossPlayer = null;
    showShop();
  }, playerWon ? 1500 : 1300);
}

function updateBoss(boss, dt, now) {
  if (boss.dead) return;

  // Boss takes lava damage via normal lava check ??? skip, use bossHp instead
  const target = players.find(p => !p.dead && !p.isBoss && p.id === 0) || 
                 players.find(p => !p.dead && !p.isBoss);
  if (!target) return;

  const dx = target.x - boss.x, dy = target.y - boss.y;
  const dist = Math.hypot(dx,dy)||1;

  if (dist < 180) {
    boss.vx -= (dx/dist) * 0.4;
    boss.vy -= (dy/dist) * 0.4;
  } else if (dist > 250) {
    boss.vx += (dx/dist) * 0.3;
    boss.vy += (dy/dist) * 0.3;
  }
  boss.vx += (Math.random()-0.5)*0.3;
  boss.vy += (Math.random()-0.5)*0.3;

  boss.missileTimer -= dt;
  if (boss.missileTimer <= 0) {
    boss.missileTimer = 2000 + Math.random()*800;
    const enemies = players.filter(p => !p.dead && !p.isBoss);
    if (enemies.length > 0) {
      const tgt = enemies.reduce((b,e)=> Math.hypot(e.x-boss.x,e.y-boss.y)<Math.hypot(b.x-boss.x,b.y-boss.y)?e:b);
      const baseAng = Math.atan2(tgt.y - boss.y, tgt.x - boss.x);
      const fanAngles = [-0.35, -0.17, 0, 0.17, 0.35];
      fanAngles.forEach(offset => {
        const ang = baseAng + offset;
        const spd = 4.8;
        projectiles.push({
          x: boss.x + Math.cos(ang)*boss.radius,
          y: boss.y + Math.sin(ang)*boss.radius,
          vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd,
          owner: boss.id, spell: 'fireball',
          damage: 20, radius: 11,
          color: '#ff0066', glow: '#ff44aa',
          isBossProjectile: true,
          distTravelled: 0, life: 220,
        });
      });
      boss.castFlash = 300;
      spawnParticlesBurst(boss.x, boss.y, '#ff0066', 20);
      SFX.fireball && SFX.fireball();
    }
  }

  if (!boss.rageMode && boss.bossHp <= boss.bossMaxHp * 0.3) {
    boss.rageMode = true;
    boss.rageLaserTimer = 4000;
    spawnParticlesBurst(boss.x, boss.y, '#ff00aa', 36);
    screenShake = Math.max(screenShake, 12);
  }
  if (boss.rageMode) {
    if (!boss.rageTelegraphing && !boss.rageSweepActive) boss.rageLaserTimer -= dt;
    if (!boss.rageSweepActive && !boss.rageTelegraphing && boss.rageLaserTimer <= 0) {
      startBossRageTelegraph(boss, target);
      boss.rageLaserTimer = 8500;
    }
    if (boss.rageTelegraphing) {
      boss.rageTelegraphTimer -= dt;
      if (boss.rageTelegraphTimer <= 0) {
        boss.rageTelegraphing = false;
        boss.rageSweepActive = true;
        clearLaserTelegraphs('rage-sweep');
        screenShake = Math.max(screenShake, 14);
      }
    }
    if (boss.rageSweepActive) {
      boss.rageSweepAngle += boss.rageSweepSpeed * dt;
      const ra = boss.rageSweepAngle;
      const rc = Math.cos(ra), rs = Math.sin(ra);
      const rRange = arenaR * 1.3;
      effects.push({
        type: 'bossLaser', x1: boss.x, y1: boss.y,
        x2: boss.x + rc*rRange, y2: boss.y + rs*rRange,
        life: 3, maxLife: 3, width: 80, isRage: true,
      });
      players.filter(p => !p.dead && !p.isBoss).forEach(p => {
        const px = p.x-boss.x, py = p.y-boss.y;
        const along = px*rc + py*rs;
        const perp  = Math.abs(-px*rs + py*rc);
        if (along > 0 && along < rRange && perp < 50 + p.radius) {
          applyDamage(p, boss, 8, rc, rs, 0.5);
        }
      });
      screenShake = Math.max(screenShake, 6);
      if (boss.rageSweepAngle >= boss.rageSweepEnd) {
        boss.rageSweepActive = false;
        clearLaserTelegraphs('rage-sweep');
      }
    }
  }

  if (boss.rageTelegraphing || boss.rageSweepActive) return;

  boss.laserTimer -= dt;
  if (!boss.laserCharging && boss.laserTimer <= 0) {
    boss.laserCharging = true;
    boss.laserChargeTimer = 1800;
    boss.laserAngle = Math.atan2(target.y - boss.y, target.x - boss.x);
    const range = arenaR * 1.2;
    laserTelegraphs.push({
      kind: 'laser',
      x1: boss.x, y1: boss.y,
      x2: boss.x + Math.cos(boss.laserAngle)*range,
      y2: boss.y + Math.sin(boss.laserAngle)*range,
      timer: 1800, maxTimer: 1800,
      width: 80,
    });
    boss.laserTimer = 6000 + Math.random()*3000;
  }

  if (boss.laserCharging) {
    boss.laserChargeTimer -= dt;
    if (boss.laserChargeTimer <= 0) {
      boss.laserCharging = false;
      fireBossLaser(boss);
      clearLaserTelegraphs('laser');
    }
  }
}

function awardBotsRoundGold(amount) {
  players.forEach(p => {
    if (p.isBot && p.lives > 0) p.gold = (p.gold || 0) + amount;
  });
}

function botBuySpell(bot, item) {
  if (!bot.activeSpells.includes(item.id)) bot.activeSpells.push(item.id);
  bot.gold -= item.cost;
}

function botBuyUpgrade(bot, item) {
  if (!bot.upgrades) bot.upgrades = {};
  bot.upgrades[item.id] = true;
  bot.gold -= item.cost;
}

function botBuySpellLevel(bot, spellName, levelData) {
  if (!bot.spellLevels) bot.spellLevels = {};
  bot.spellLevels[spellName] = ((bot.spellLevels[spellName] || 1) + 1);
  bot.gold -= levelData.cost;
}

function runBotShop() {
  const spellOffers = SHOP_ITEMS.filter(i => i.type === 'spell');
  const classicUpgrades = SHOP_ITEMS.filter(i => i.type === 'upgrade');

  players.filter(p => p.isBot && p.lives > 0).forEach(bot => {
    let safety = 0;
    while ((bot.gold || 0) >= 60 && safety < 8) {
      safety++;
      const options = [];

      spellOffers.forEach(item => {
        if (!bot.activeSpells.includes(item.id) && bot.gold >= item.cost) {
          options.push({ type: 'spell', item, score: 30 + (bot.activeSpells.length < 4 ? 20 : 0) + Math.random() * 12 });
        }
      });

      classicUpgrades.forEach(item => {
        if (item.spell && !bot.activeSpells.includes(item.spell)) return;
        if (bot.upgrades && bot.upgrades[item.id]) return;
        if (bot.gold >= item.cost) {
          options.push({ type: 'upgrade', item, score: 26 + Math.random() * 16 });
        }
      });

      if (bot.activeSpells.includes('fireball')) {
        const curLvl = (bot.spellLevels && bot.spellLevels.fireball) || 1;
        if (curLvl < FIREBALL_LEVELS.length - 1) {
          const next = FIREBALL_LEVELS[curLvl + 1];
          if (bot.gold >= next.cost) {
            options.push({ type: 'spell_level', spell: 'fireball', levelData: next, score: 34 + Math.random() * 10 });
          }
        }
      }
      if (bot.activeSpells.includes('lightning')) {
        const curLvl = (bot.spellLevels && bot.spellLevels.lightning) || 1;
        if (curLvl < LIGHTNING_LEVELS.length - 1) {
          const next = LIGHTNING_LEVELS[curLvl + 1];
          if (bot.gold >= next.cost) {
            options.push({ type: 'spell_level', spell: 'lightning', levelData: next, score: 32 + Math.random() * 10 });
          }
        }
      }

      if (!options.length) break;
      options.sort((a, b) => b.score - a.score);
      const choice = options[0];
      if (choice.type === 'spell') botBuySpell(bot, choice.item);
      else if (choice.type === 'upgrade') botBuyUpgrade(bot, choice.item);
      else if (choice.type === 'spell_level') botBuySpellLevel(bot, choice.spell, choice.levelData);
    }
  });
}

function fireBossLaser(boss) {
  const range   = arenaR * 1.2;
  const halfW   = 55;
  const cos0    = Math.cos(boss.laserAngle);
  const sin0    = Math.sin(boss.laserAngle);
  screenShake   = 18; // trigger screen shake

  // Add laser beam effect
  effects.push({
    type: 'bossLaser',
    x1: boss.x, y1: boss.y,
    x2: boss.x + cos0*range, y2: boss.y + sin0*range,
    life: 25, maxLife: 25, width: halfW*2,
  });
  SFX.lightning && SFX.lightning();
  spawnParticlesBurst(boss.x, boss.y, '#ff0066', 30);

  // Damage all players in laser path
  players.filter(p => !p.dead && !p.isBoss).forEach(p => {
    // Project player onto laser direction
    const px = p.x - boss.x, py = p.y - boss.y;
    const along = px*cos0 + py*sin0; // distance along laser
    if (along < 0 || along > range) return;
    const perp = Math.abs(-px*sin0 + py*cos0); // distance perpendicular
    if (perp < halfW + p.radius) {
      applyDamage(p, boss, 45, cos0, sin0, 1.5);
    }
  });
}

function checkBossDead(boss) {
  // Boss dies by taking enough damage, not by falling in lava
  if (!boss || boss.dead) return false;
  if (boss.bossHp <= 0) {
    boss.dead = true;
    boss.deadTimer = 2000;
    boss.lives = 0;
    SFX.death && SFX.death(false);
    spawnParticlesBurst(boss.x, boss.y, '#ff0066', 60);
    spawnParticlesBurst(boss.x, boss.y, '#ffdd00', 40);
    awardBossKillGold();
    return true;
  }
  return false;
}

function awardBossKillGold() {
  const killer = players.find(p => p.id === (bossPlayer ? bossPlayer.lastHitBy : -1));
  if (killer && killer.isBot) {
    killer.gold = (killer.gold || 0) + 50;
    showGoldPop(killer.x, killer.y - 40, '+50g BOSS KILL!');
    return;
  }
  playerGold += 50;
  showGoldPop(players[0].x, players[0].y - 40, '+50g BOSS KILL!');
  SFX.goldPickup && SFX.goldPickup();
}

function drawBossHpBar(boss) {
  if (boss.dead) return;
  const barW = Math.min(200, arenaR * 0.8);
  const barH = 10;
  const bx   = arenaX - barW/2;
  const by   = arenaY + arenaR * (lavaRadius || 1) * 0.92;
  ctx.save();
  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.roundRect(bx, by, barW, barH, 5); ctx.fill();
  // HP fill
  const pct = Math.max(0, boss.bossHp / boss.bossMaxHp);
  const hpColor = pct > 0.5 ? '#ff0066' : pct > 0.25 ? '#ff8800' : '#ff2200';
  ctx.fillStyle = hpColor;
  ctx.shadowColor = hpColor; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.roundRect(bx, by, barW * pct, barH, 5); ctx.fill();
  // Label
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 9px Cinzel, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`⚔️ BOSS  ${boss.bossHp} / ${boss.bossMaxHp}`, arenaX, by - 14);
  ctx.restore();
}

function drawLaserTelegraphs() {
  if (!laserTelegraphs.length) return;
  laserTelegraphs = laserTelegraphs.filter(t => t.timer > 0);
  laserTelegraphs.forEach(t => {
    t.timer -= 16;
    const pct   = t.timer / t.maxTimer;
    const pulse = 0.4 + 0.6*Math.abs(Math.sin(t.timer * 0.01));

    if (t.cx !== undefined) {
      ctx.save();
      ctx.globalAlpha = pct * (0.35 + pulse * 0.45);
      const sectorFill = ctx.createRadialGradient(t.cx, t.cy, t.radius * 0.12, t.cx, t.cy, t.radius);
      sectorFill.addColorStop(0, 'rgba(255,255,255,0.4)');
      sectorFill.addColorStop(0.25, 'rgba(255,120,0,0.35)');
      sectorFill.addColorStop(0.75, 'rgba(255,0,90,0.18)');
      sectorFill.addColorStop(1, 'rgba(255,0,90,0)');
      ctx.fillStyle = sectorFill;
      ctx.beginPath();
      ctx.moveTo(t.cx, t.cy);
      ctx.arc(t.cx, t.cy, t.radius, t.startAngle, t.endAngle);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,160,120,' + (0.35 + pulse * 0.5) + ')';
      ctx.lineWidth = 4;
      ctx.setLineDash([16, 10]);
      ctx.beginPath();
      ctx.arc(t.cx, t.cy, t.radius * 0.84, t.startAngle, t.endAngle);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = pct * pulse * 0.7;
    const ang = Math.atan2(t.y2-t.y1, t.x2-t.x1);
    const len  = Math.hypot(t.x2-t.x1, t.y2-t.y1);
    ctx.translate(t.x1, t.y1); ctx.rotate(ang);
    const grad = ctx.createLinearGradient(0,0,len,0);
    grad.addColorStop(0, 'rgba(255,0,80,0.8)');
    grad.addColorStop(0.5, 'rgba(255,80,0,0.5)');
    grad.addColorStop(1, 'rgba(255,0,80,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.rect(0, -t.width/2, len, t.width);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,80,80,' + (0.8*pulse) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([12,8]);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(len,0); ctx.stroke();
    ctx.restore();
  });
}

function awardKillGold(deadPlayer) {
  if (deadPlayer.id === 0) return;
  const now = performance.now();
  const killerSelf = deadPlayer.lastHitBy;

  if (killerSelf === 0 && !players[0].dead) {
    playerGold += 15;
    showGoldPop(players[0].x, players[0].y - 30, '+15g KILL!');
    SFX.goldPickup();
  } else {
    const assistHit = (deadPlayer.hitLog||[]).find(h => h.attackerId === 0 && now - h.time < 2000);
    if (assistHit && !players[0].dead) {
      playerGold += 7;
      showGoldPop(players[0].x, players[0].y - 30, '+7g ASSIST');
      SFX.goldPickup();
    }
  }

  const killerBot = players.find(p => p.id === killerSelf && p.isBot && !p.dead);
  if (killerBot) {
    killerBot.gold = (killerBot.gold || 0) + 15;
    showGoldPop(killerBot.x, killerBot.y - 24, '+15g');
  }
}

function checkRoundEnd() {
  if (!gameRunning || roundEndPending || spectatorMode) return;

  const player    = players[0];
  const aliveBots = players.filter(p => p.isBot && !p.dead && !p.isBoss);
  const aliveAll  = players.filter(p => !p.dead);
  const bossDead  = isBossRound && bossPlayer && bossPlayer.dead;
  const aliveRaiders = players.filter(p => !p.dead && !p.isBoss);

  if (player.lives <= 0 && player.dead) {
    roundEndPending = true;
    if (isBossRound) {
      roundEndPending = false;
      if (bossDead) {
        finishBossRound(true);
      } else if (aliveRaiders.length > 0) {
        enterSpectatorMode();
      } else {
        finishBossRound(false);
      }
    } else if (aliveBots.length >= 2) {
      roundEndPending = false;
      enterSpectatorMode();
    } else {
      setTimeout(() => presentGameOver(false), 800);
    }
    return;
  }

  if (isBossRound && bossDead) {
    finishBossRound(true);
    return;
  }

  if (isBossRound && aliveRaiders.length === 0) {
    finishBossRound(false);
    return;
  }

  if (isBossRound) return;
  if (aliveAll.length > 1) return;
  roundEndPending = true;

  playerGold += 20;
  if (!player.dead) showGoldPop(player.x, player.y - 30, '+20g STAGE CLEAR!');
  awardBotsRoundGold(20);
  round++;
  setTimeout(() => { gameRunning = false; showShop(); }, 1000);
}

function enterSpectatorMode() {
  spectatorMode = true;
  spectatorSwapTimer = 4000;
  // Pick first living bot to follow
  const liveBots = players.filter(p => p.isBot && !p.dead && p.lives > 0);
  spectatorTarget = liveBots.length > 0 ? liveBots[0] : null;
}

function updateSpectator(dt) {
  if (!spectatorMode) return;
  const liveBots = players.filter(p => p.isBot && !p.dead);
  const liveRaiders = players.filter(p => !p.dead && !p.isBoss);

  if (isBossRound) {
    if (bossPlayer && bossPlayer.dead) {
      spectatorMode = false;
      spectatorTarget = null;
      finishBossRound(true);
      return;
    }
    if (liveRaiders.length === 0) {
      spectatorMode = false;
      spectatorTarget = null;
      finishBossRound(false);
      return;
    }
  }

  if (liveBots.length <= 1 && !isBossRound) {
    spectatorMode = false;
    spectatorTarget = null;
    roundEndPending = true;
    setTimeout(() => presentGameOver(false), 1500);
    return;
  }

  spectatorSwapTimer -= dt;
  if (spectatorSwapTimer <= 0 || !spectatorTarget || spectatorTarget.dead) {
    const others = liveBots.filter(p => p !== spectatorTarget);
    spectatorTarget = others[Math.floor(Math.random() * Math.max(others.length, 1))] || liveBots[0] || null;
    spectatorSwapTimer = 3000 + Math.random() * 2000;
  }
}

function presentGameOver(playerWon) {
  gameRunning = false;
  if (menuViewEl) menuViewEl.classList.add('hidden');
  if (resultPanelEl) resultPanelEl.classList.add('visible');
  if (resultTitleEl) resultTitleEl.textContent = playerWon ? 'Victory!' : 'Defeated!';
  if (resultTextEl) {
    resultTextEl.textContent = playerWon ? 'You vanquished all warlocks!' : 'You have fallen...';
    resultTextEl.className = 'result-text ' + (playerWon ? 'p1-win' : 'p2-win');
  }
  if (resultSubtitleEl) resultSubtitleEl.textContent = `After ${round} rounds · ${playerGold}g earned`;
  if (overlayEl) overlayEl.style.display = 'flex';
}

function showGameOver(playerWon) {
  gameRunning = false;
  const ov = document.getElementById('overlay');
  ov.innerHTML = `
    <h1>${playerWon ? 'Victory!' : 'Defeated!'}</h1>
    <div class="result-text ${playerWon ? 'p1-win' : 'p2-win'}">${playerWon ? 'You vanquished all warlocks!' : 'You have fallen...'}</div>
    <div class="subtitle" style="margin-top:4px; margin-bottom:8px;">After ${round} rounds · ${playerGold}g earned</div>
    <button class="big-btn" id="startBtn">⚔️ Play Again</button>
  `;
  ov.style.display = 'flex';
  document.getElementById('startBtn').addEventListener('touchstart', startGame, { passive: false });
  document.getElementById('startBtn').addEventListener('click', startGame);
}

// ─────────────────────────────────────────────
// DRAW
// ─────────────────────────────────────────────
function drawArena() {
  lavaAngle += 0.008;
  const effectiveR = arenaR * lavaRadius;
  if (lowFxMode) {
    const dangerPct = 1 - (lavaRadius - 0.45) / 0.55;
    ctx.save();
    ctx.fillStyle = 'rgba(32,18,44,0.95)';
    ctx.beginPath(); ctx.arc(arenaX, arenaY, effectiveR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dangerPct > 0.45 ? '#ff5a36' : '#8c62ff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(arenaX, arenaY, effectiveR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(arenaX + Math.cos(a) * 12, arenaY + Math.sin(a) * 12);
      ctx.lineTo(arenaX + Math.cos(a) * effectiveR * 0.84, arenaY + Math.sin(a) * effectiveR * 0.84);
      ctx.stroke();
    }
    const ringColor = dangerPct > 0.55 ? 'rgba(255,90,40,0.28)' : 'rgba(120,80,220,0.18)';
    ctx.fillStyle = ringColor;
    ctx.beginPath(); ctx.arc(arenaX, arenaY, effectiveR * 1.08, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.8;
    const barW = Math.min(canvas.width * 0.35, 220);
    const barH = 5;
    const barX = arenaX - barW / 2;
    const barY = arenaY - effectiveR - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 3); ctx.fill();
    ctx.fillStyle = dangerPct > 0.55 ? '#ff5a36' : '#ff9d37';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW * ((lavaRadius - 0.45) / 0.55), barH, 3); ctx.fill();
    ctx.restore();
    return;
  }
  // Warn pulse when arena is small
  const dangerPct = 1 - (lavaRadius - 0.45) / 0.55;
  if (dangerPct > 0.3) {
    ctx.save();
    ctx.globalAlpha = dangerPct * 0.18 * (0.7 + 0.3*Math.sin(lavaAngle*6));
    ctx.fillStyle = '#ff2200';
    ctx.beginPath(); ctx.arc(arenaX, arenaY, arenaR*1.6, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  // Shrink progress bar + label
  const shrinkPct = (lavaRadius - 0.45) / 0.55; // 1=full, 0=fully shrunk
  ctx.save();
  const barW = Math.min(canvas.width * 0.35, 220);
  const barH = 5;
  const barX = arenaX - barW/2;
  const barY = arenaY - effectiveR - 22;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 3); ctx.fill();
  const fillColor = shrinkPct > 0.6 ? '#ff6b35' : shrinkPct > 0.3 ? '#ff2200' : '#ff0000';
  const grd = ctx.createLinearGradient(barX, 0, barX+barW, 0);
  grd.addColorStop(0, '#ff8800'); grd.addColorStop(1, fillColor);
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.roundRect(barX, barY, barW * shrinkPct, barH, 3); ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = dangerPct > 0.5 ? '#ff4400' : 'rgba(255,200,100,0.8)';
  ctx.font = `bold 9px Cinzel, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('🌋 LAVA RISING', arenaX, barY - 2);
  ctx.restore();
  // Lava glow outer
  const lgrd = ctx.createRadialGradient(arenaX, arenaY, effectiveR*0.7, arenaX, arenaY, effectiveR*1.4);
  lgrd.addColorStop(0, 'rgba(255,80,0,0.0)');
  lgrd.addColorStop(0.5, `rgba(${180+Math.sin(lavaAngle)*40},${40+Math.sin(lavaAngle*1.3)*20},0,0.18)`);
  lgrd.addColorStop(1, 'rgba(255,20,0,0.35)');
  ctx.fillStyle = lgrd;
  ctx.beginPath(); ctx.arc(arenaX, arenaY, effectiveR * 1.45, 0, Math.PI*2); ctx.fill();

  // Lava dots
  for (let i = 0; i < 18; i++) {
    const a = lavaAngle * 0.7 + i * (Math.PI * 2 / 18);
    const r = effectiveR + 10 + Math.sin(lavaAngle * 2 + i) * 8;
    const ox = arenaX + Math.cos(a) * r * 0.98;
    const oy = arenaY + Math.sin(a) * r * 0.98;
    const sz = 5 + Math.sin(lavaAngle * 3 + i) * 3;
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, sz * 2.5);
    g.addColorStop(0, `rgba(255,${120+Math.sin(i)*60},0,0.9)`);
    g.addColorStop(1, 'rgba(255,30,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ox, oy, sz * 2.5, 0, Math.PI*2); ctx.fill();
  }

  // Stone platform
  const sgrd = ctx.createRadialGradient(arenaX, arenaY - effectiveR*0.1, 0, arenaX, arenaY, effectiveR);
  sgrd.addColorStop(0, '#3a3040');
  sgrd.addColorStop(0.65, '#2a2035');
  sgrd.addColorStop(1, '#1a1225');
  ctx.fillStyle = sgrd;
  ctx.beginPath(); ctx.arc(arenaX, arenaY, effectiveR, 0, Math.PI*2); ctx.fill();

  // Platform edge
  ctx.strokeStyle = `rgba(${100+Math.sin(lavaAngle)*30},${50+Math.sin(lavaAngle)*20},150,0.6)`;
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(arenaX, arenaY, effectiveR, 0, Math.PI*2); ctx.stroke();

  // Stone texture lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    ctx.beginPath();
    ctx.moveTo(arenaX + Math.cos(a)*10, arenaY + Math.sin(a)*10);
    ctx.lineTo(arenaX + Math.cos(a)*effectiveR*0.85, arenaY + Math.sin(a)*effectiveR*0.85);
    ctx.stroke();
  }

  // Inner glow ring
  const ig = ctx.createRadialGradient(arenaX, arenaY, effectiveR*0.75, arenaX, arenaY, effectiveR);
  ig.addColorStop(0, 'rgba(100,60,200,0.0)');
  ig.addColorStop(1, 'rgba(80,40,160,0.18)');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.arc(arenaX, arenaY, effectiveR, 0, Math.PI*2); ctx.fill();
}


// ─────────────────────────────────────────────
// BOSS SPRITE (monster SVG-style on canvas)
// ─────────────────────────────────────────────
function drawBossSprite(boss) {
  if (!boss) return;
  if (lowFxMode) {
    drawSimpleBossSprite(boss);
    return;
  }
  const r   = boss.radius; // 36
  const now = performance.now();
  const pulse = 0.7 + 0.3 * Math.sin(now * 0.004);
  const isCharging = boss.laserCharging;
  const isRage     = boss.rageMode;
  const isDead     = boss.dead;

  ctx.save();
  ctx.translate(boss.x, boss.y);

  if (isDead) {
    ctx.rotate(boss.deathSpin || 0);
    ctx.globalAlpha = Math.max(0, (boss.deadTimer||0) / 2000);
    if ((boss.deadTimer||0) <= 0) { ctx.restore(); return; }
    ctx.scale(1 + (1-(boss.deadTimer/2000))*0.6, 1 + (1-(boss.deadTimer/2000))*0.6);
  }

  // ── Aura glow ──
  const auraColor = isRage ? '#ff00aa' : '#cc0044';
  const auraGrd = ctx.createRadialGradient(0, 0, r*0.5, 0, 0, r*2.2);
  auraGrd.addColorStop(0, auraColor + '44');
  auraGrd.addColorStop(0.6, auraColor + '22');
  auraGrd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = auraGrd;
  ctx.beginPath(); ctx.arc(0, 0, r*2.2, 0, Math.PI*2); ctx.fill();

  // ── Shadow beneath ──
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, r*1.1, r*1.1, r*0.28, 0, 0, Math.PI*2); ctx.fill();

  // ── Body — hulking torso ──
  const bodyColor  = isRage ? '#8b0030' : '#6b0022';
  const bodyColor2 = isRage ? '#cc0050' : '#aa0033';
  const bodyGrd = ctx.createRadialGradient(-r*0.2, -r*0.2, 0, 0, 0, r*1.3);
  bodyGrd.addColorStop(0, bodyColor2);
  bodyGrd.addColorStop(1, bodyColor);
  ctx.fillStyle   = bodyGrd;
  ctx.shadowColor = isRage ? '#ff0066' : '#880022';
  ctx.shadowBlur  = 18 * pulse;

  // Main body blob
  ctx.beginPath();
  ctx.moveTo(0, -r*1.1);
  ctx.bezierCurveTo( r*0.9, -r*0.9,  r*1.2,  r*0.0,  r*1.0,  r*0.8);
  ctx.bezierCurveTo( r*0.7,  r*1.2,  -r*0.7,  r*1.2, -r*1.0,  r*0.8);
  ctx.bezierCurveTo(-r*1.2,  r*0.0, -r*0.9, -r*0.9,  0,      -r*1.1);
  ctx.closePath(); ctx.fill();

  // Body sheen
  ctx.fillStyle = 'rgba(255,100,140,0.12)';
  ctx.beginPath(); ctx.ellipse(-r*0.25, -r*0.3, r*0.45, r*0.7, -0.3, 0, Math.PI*2); ctx.fill();
  if (isRage) {
    ctx.fillStyle = 'rgba(255,40,120,0.28)';
    [-0.9, -0.45, 0, 0.45, 0.9].forEach(spikeX => {
      ctx.beginPath();
      ctx.moveTo(spikeX * r * 0.82, -r * 0.65);
      ctx.lineTo(spikeX * r * 0.55, -r * 1.35);
      ctx.lineTo(spikeX * r * 0.28, -r * 0.52);
      ctx.closePath();
      ctx.fill();
    });
  }

  // ── Armour plates ──
  ctx.fillStyle = isRage ? '#660020' : '#440015';
  ctx.strokeStyle = isRage ? '#ff3366' : '#cc1133';
  ctx.lineWidth = 1.5;
  // Chest plate
  ctx.beginPath();
  ctx.moveTo(-r*0.5, -r*0.1);
  ctx.lineTo( r*0.5, -r*0.1);
  ctx.lineTo( r*0.35, r*0.55);
  ctx.lineTo(-r*0.35, r*0.55);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // Shoulder pads
  [[-1, 1]].forEach(([sx]) => {
    ctx.beginPath();
    ctx.ellipse(sx*r*0.88, -r*0.25, r*0.32, r*0.2, sx*0.4, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
  });
  ctx.beginPath(); ctx.ellipse( r*0.88, -r*0.25, r*0.32, r*0.2,  0.4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-r*0.88, -r*0.25, r*0.32, r*0.2, -0.4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  if (isRage) {
    ctx.fillStyle = '#2b0010';
    ctx.strokeStyle = '#ff4d88';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -r*0.22);
    ctx.lineTo(r*0.18, r*0.15);
    ctx.lineTo(0, r*0.5);
    ctx.lineTo(-r*0.18, r*0.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ── Arms — reaching out ──
  const armWiggle = Math.sin(now*0.003)*0.15;
  ctx.fillStyle = bodyColor2;
  ctx.strokeStyle = isRage ? '#ff2255' : '#990022';
  ctx.lineWidth = 2;
  // Left arm
  ctx.save();
  ctx.translate(-r*1.0, r*0.1);
  ctx.rotate(-0.5 + armWiggle);
  ctx.beginPath();
  ctx.ellipse(0, 0, r*0.22, r*0.55, 0, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();
  // Claw
  ctx.fillStyle = '#330010';
  ctx.strokeStyle = '#ff2244';
  ctx.lineWidth = 1;
  for (let c = -1; c <= 1; c++) {
    ctx.save(); ctx.translate(c*r*0.12, r*0.6); ctx.rotate(c*0.35);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(r*0.06, r*0.32); ctx.lineTo(-r*0.06, r*0.32); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  // Right arm
  ctx.save();
  ctx.translate(r*1.0, r*0.1);
  ctx.rotate(0.5 - armWiggle);
  ctx.fillStyle = bodyColor2;
  ctx.strokeStyle = isRage ? '#ff2255' : '#990022';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, r*0.22, r*0.55, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#330010'; ctx.strokeStyle = '#ff2244'; ctx.lineWidth = 1;
  for (let c = -1; c <= 1; c++) {
    ctx.save(); ctx.translate(c*r*0.12, r*0.6); ctx.rotate(c*0.35);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(r*0.06, r*0.32); ctx.lineTo(-r*0.06, r*0.32); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // ── Head ──
  const headGrd = ctx.createRadialGradient(-r*0.1, -r*0.85, 0, 0, -r*0.9, r*0.65);
  headGrd.addColorStop(0, isRage ? '#cc003a' : '#9b0028');
  headGrd.addColorStop(1, isRage ? '#770025' : '#550015');
  ctx.fillStyle   = headGrd;
  ctx.shadowColor = isRage ? '#ff0066' : '#880022';
  ctx.shadowBlur  = 12;
  ctx.beginPath(); ctx.ellipse(0, -r*0.9, r*0.58, r*0.5, 0, 0, Math.PI*2); ctx.fill();

  // ── Horns ──
  ctx.fillStyle = isRage ? '#ffaacc' : '#cc8899';
  ctx.strokeStyle = isRage ? '#ff3366' : '#880033';
  ctx.lineWidth = 1.5;
  const hornWiggle = Math.sin(now*0.002)*0.06;
  // Left horn
  ctx.save(); ctx.translate(-r*0.38, -r*1.28); ctx.rotate(-0.4 + hornWiggle);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-r*0.14, -r*0.52); ctx.lineTo(r*0.1, 0); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();
  // Right horn
  ctx.save(); ctx.translate(r*0.38, -r*1.28); ctx.rotate(0.4 - hornWiggle);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(r*0.14, -r*0.52); ctx.lineTo(-r*0.1, 0); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();
  // Inner horn spikes (smaller)
  ctx.fillStyle = '#ff5588';
  ctx.save(); ctx.translate(-r*0.18, -r*1.32); ctx.rotate(-0.2);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-r*0.07,-r*0.28); ctx.lineTo(r*0.05,0); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate( r*0.18, -r*1.32); ctx.rotate(0.2);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo( r*0.07,-r*0.28); ctx.lineTo(-r*0.05,0); ctx.closePath(); ctx.fill(); ctx.restore();
  if (isRage) {
    ctx.fillStyle = '#ff77dd';
    ctx.strokeStyle = '#ffd6ff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -r*1.45);
    ctx.lineTo(r*0.12, -r*1.08);
    ctx.lineTo(-r*0.12, -r*1.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ── Eyes ──
  const eyeGlow = isRage ? 0.9 : 0.7;
  const eyeColor = isRage ? '#ff66cc' : '#ff2244';
  const eyePupil = isCharging ? '#ffffff' : (isRage ? '#ffccff' : '#ffaacc');
  const eyeBlink = Math.sin(now*0.0018) > 0.96 ? 0.15 : 1;
  [-0.24, 0.24].forEach(ex => {
    // Eye socket
    ctx.fillStyle = '#220008';
    ctx.beginPath(); ctx.ellipse(ex*r, -r*0.9, r*0.17, r*0.13*eyeBlink, 0, 0, Math.PI*2); ctx.fill();
    // Eye glow
    ctx.fillStyle = eyeColor;
    ctx.shadowColor = eyeColor; ctx.shadowBlur = 14 * pulse;
    ctx.beginPath(); ctx.ellipse(ex*r, -r*0.9, r*0.14, r*0.11*eyeBlink, 0, 0, Math.PI*2); ctx.fill();
    // Pupil
    ctx.fillStyle = eyePupil;
    ctx.shadowBlur = 0;
    if (isCharging) {
      ctx.beginPath(); ctx.arc(ex*r, -r*0.9, r*0.07, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(ex*r, -r*0.88, r*0.05, r*0.08*eyeBlink, 0, 0, Math.PI*2); ctx.fill();
    }
  });
  if (isRage) {
    ctx.fillStyle = '#220008';
    ctx.beginPath(); ctx.ellipse(0, -r*1.03, r*0.12, r*0.09, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffb3ff';
    ctx.shadowColor = '#ff77ff';
    ctx.shadowBlur = 16 * pulse;
    ctx.beginPath(); ctx.ellipse(0, -r*1.03, r*0.08, r*0.05, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ── Mouth ──
  ctx.strokeStyle = '#ff2244';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  if (isRage) {
    ctx.beginPath();
    ctx.moveTo(-r*0.28, -r*0.72);
    ctx.quadraticCurveTo(0, -r*0.42, r*0.28, -r*0.72);
    ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(0, -r*0.72, r*0.3, 0.3, Math.PI-0.3); ctx.stroke();
  }
  // Fangs
  ctx.fillStyle = '#ffccdd';
  [[-0.15, 0], [0.15, 0]].forEach(([fx]) => {
    ctx.beginPath();
    ctx.moveTo(fx*r, -r*0.72);
    ctx.lineTo((fx-0.04)*r, -r*0.58);
    ctx.lineTo((fx+0.04)*r, -r*0.58);
    ctx.closePath(); ctx.fill();
  });
  ctx.fillStyle = '#ff8899';
  ctx.beginPath(); ctx.arc(0, -r*0.7, r*0.04, 0, Math.PI*2); ctx.fill();

  // ── Rage fire effect ──
  if (isRage) {
    for (let fi = 0; fi < 6; fi++) {
      const fa  = (fi/6)*Math.PI*2 + now*0.003;
      const fr  = r*(0.9 + 0.4*Math.sin(now*0.005+fi));
      const fsz = r*(0.25 + 0.2*Math.sin(now*0.007+fi));
      const fx  = Math.cos(fa)*fr, fy = Math.sin(fa)*fr;
      const fGrd = ctx.createRadialGradient(fx, fy, 0, fx, fy, fsz*2.5);
      fGrd.addColorStop(0, 'rgba(255,100,200,0.9)');
      fGrd.addColorStop(0.5, 'rgba(255,0,100,0.5)');
      fGrd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fGrd;
      ctx.beginPath(); ctx.arc(fx, fy, fsz*2.5, 0, Math.PI*2); ctx.fill();
    }
  }

  // ── Charging laser flash ──
  if (isCharging) {
    ctx.globalAlpha = 0.3 + 0.3*pulse;
    const cGrd = ctx.createRadialGradient(0, 0, 0, 0, 0, r*2);
    cGrd.addColorStop(0, 'rgba(255,200,255,0.9)');
    cGrd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cGrd;
    ctx.beginPath(); ctx.arc(0, 0, r*2, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── HP percentage ──
  if (!isDead) {
    const hpPct = Math.max(0, boss.bossHp / boss.bossMaxHp);
    const hpColor = hpPct > 0.5 ? '#ff6688' : hpPct > 0.3 ? '#ff8800' : '#ff2200';
    ctx.fillStyle = hpColor;
    ctx.shadowColor = hpColor; ctx.shadowBlur = 8;
    ctx.font = `bold ${Math.round(r*0.38)}px Cinzel, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(Math.ceil(hpPct*100)+'%', 0, -r*1.65);
  }

  ctx.restore();
}

function drawSimpleWarlock(p) {
  const r = p.radius;
  const now = performance.now();
  const pulse = 0.92 + Math.sin(now * 0.006) * 0.08;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.dead) {
    ctx.rotate(p.deathSpin || 0);
    ctx.globalAlpha = Math.max(0, p.deadTimer / 2000);
    if (p.deadTimer <= 0) { ctx.restore(); return; }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.beginPath(); ctx.ellipse(0, r * 0.92, r * 0.72, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (p.shieldActive) {
    ctx.strokeStyle = 'rgba(129,199,132,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r + 15, 0, Math.PI * 2); ctx.stroke();
  }
  if (p.frozenUntil && now < p.frozenUntil) {
    ctx.strokeStyle = 'rgba(140,220,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.48);
  ctx.lineTo(-r * 0.8, r * 0.95);
  ctx.lineTo(r * 0.8, r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shadeColor(p.color, -36);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = p.id === 0 ? '#f0d5b0' : '#cde8f8';
  ctx.beginPath(); ctx.arc(0, -r * 0.42, r * 0.34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#120818';
  ctx.beginPath(); ctx.arc(-r * 0.1, -r * 0.44, r * 0.04, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.1, -r * 0.44, r * 0.04, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.rotate(p.angle);
  ctx.strokeStyle = '#d7b98a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.02); ctx.lineTo(r * 1.7, -r * 0.02); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(r * 1.82, -r * 0.02, r * 0.16 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawWarlock(p) {
  if (p.isBoss) { drawBossSprite(p); return; } // boss has its own sprite
  if (lowFxMode) { drawSimpleWarlock(p); return; }
  const r = p.radius;
  const isDead = p.dead;

  ctx.save();
  ctx.translate(p.x, p.y);

  if (isDead) {
    ctx.rotate(p.deathSpin);
    ctx.globalAlpha = Math.max(0, p.deadTimer / 2000);
    if (p.deadTimer <= 0) { ctx.restore(); return; } // fully gone
    ctx.scale(1 + (1 - p.deadTimer/2000)*0.5, 1 + (1 - p.deadTimer/2000)*0.5);
  }

  // ── Animation values ──
  const walk  = p.walkPhase;
  const idle  = p.idlePhase;
  const isMoving = p.isMoving && !isDead;

  // Body bob: moves up when walking, breathes when idle
  const bodyBob   = isMoving ? Math.abs(Math.sin(walk)) * -3 : Math.sin(idle) * -1.2;
  // Lean: tilt body in movement direction
  const leanX     = isMoving ? Math.sin(walk * 0.5) * 0.08 : 0;
  // Robe hem sway
  const hemSway   = isMoving ? Math.sin(walk) * 4 : Math.sin(idle*0.7) * 1.2;
  // Sleeve (arm) swing — alternating
  const armL      = isMoving ? Math.sin(walk) * 0.45 : Math.sin(idle) * 0.08;
  const armR      = isMoving ? -Math.sin(walk) * 0.45 : -Math.sin(idle) * 0.08;
  // Hat tilt
  const hatTilt   = isMoving ? Math.sin(walk * 0.5) * 0.12 : Math.sin(idle * 0.6) * 0.03;
  // Beard sway
  const beardSway = isMoving ? Math.sin(walk) * 2.5 : Math.sin(idle * 0.8) * 0.8;
  // Cast flash
  const castGlow  = Math.max(0, p.castFlash / 220);

  ctx.translate(0, bodyBob);
  ctx.rotate(leanX);

  // ── Ground shadow ──
  ctx.save();
  ctx.translate(0, -bodyBob + r * 0.88);
  const shadowW = r * (0.85 + (isMoving ? Math.abs(Math.sin(walk))*0.2 : 0));
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 0, shadowW, 4, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // ── Shield bubble ──
  if (p.shieldActive) {
    ctx.save();
    const sg = ctx.createRadialGradient(0,0,r+2,0,0,r+22);
    sg.addColorStop(0,'rgba(129,199,132,0.4)');
    sg.addColorStop(1,'rgba(129,199,132,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(0,0,r+22,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(129,199,132,0.8)'; ctx.lineWidth=2;
    ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.arc(0,0,r+13,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Cast flash aura ──
  if (castGlow > 0) {
    ctx.save();
    const cf = ctx.createRadialGradient(0,0,0,0,0,r*3.5);
    cf.addColorStop(0, p.color + Math.round(castGlow*160).toString(16).padStart(2,'0'));
    cf.addColorStop(1, p.color + '00');
    ctx.fillStyle = cf;
    ctx.beginPath(); ctx.arc(0,0,r*3.5,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // ── Ambient glow ──
  const aura = ctx.createRadialGradient(0,0,0,0,0,r*3);
  aura.addColorStop(0, p.color+'38');
  aura.addColorStop(1, p.color+'00');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(0,0,r*3,0,Math.PI*2); ctx.fill();

  // ── FREEZE effect ──
  if (p.frozenUntil && performance.now() < p.frozenUntil) {
    ctx.save();
    const ft = 1 - (p.frozenUntil - performance.now()) / 800;
    ctx.strokeStyle = 'rgba(140,220,255,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.arc(0,-r*0.3, r*1.1, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    const fg = ctx.createRadialGradient(0,0,0,0,0,r*1.6);
    fg.addColorStop(0,'rgba(140,220,255,0.22)');
    fg.addColorStop(1,'rgba(140,220,255,0)');
    ctx.fillStyle=fg;
    ctx.beginPath(); ctx.arc(0,0,r*1.6,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // ── DASH TRAIL (ghost images behind) ──
  const dashF = Math.max(0, p.dashFlash / 400);
  if (p.dashTrail && p.dashTrail.length > 0) {
    p.dashTrail.forEach((ghost, gi) => {
      ctx.save();
      ctx.translate(ghost.x - p.x, ghost.y - p.y); // offset relative to current translate
      ctx.globalAlpha = ghost.life * 0.35;
      // Blue ghost silhouette robe
      ctx.fillStyle = '#38aaff';
      ctx.beginPath();
      ctx.moveTo(-r*0.7, -r*0.12);
      ctx.bezierCurveTo(-r*0.88, r*0.3, -r*0.65, r*0.72, -r*0.42, r*1.0);
      ctx.bezierCurveTo(-r*0.1, r*1.06, r*0.1, r*1.06, r*0.42, r*1.0);
      ctx.bezierCurveTo(r*0.65, r*0.72, r*0.88, r*0.3, r*0.7, -r*0.12);
      ctx.closePath(); ctx.fill();
      // Ghost hat
      ctx.beginPath();
      ctx.moveTo(-r*0.44,-r*0.7);
      ctx.bezierCurveTo(-r*0.3,-r*0.82,-r*0.12,-r*1.2,-r*0.065,-r*1.65);
      ctx.lineTo(r*0.065,-r*1.65); ctx.bezierCurveTo(r*0.12,-r*1.2,r*0.3,-r*0.82,r*0.44,-r*0.7);
      ctx.closePath(); ctx.fill();
      // Ghost head
      ctx.beginPath(); ctx.arc(0,-r*0.44,r*0.37,0,Math.PI*2); ctx.fill();
      // Blue streak lines
      ctx.save();
      ctx.rotate(ghost.angle);
      ctx.strokeStyle = '#00ccff';
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = ghost.life * 0.5;
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-r*1.2, 0); ctx.stroke();
      ctx.restore();
      ctx.restore();
    });
  }

  // ── HIT FLASH (white) ──
  const hitF = Math.max(0, (p.hitFlash || 0) / 500);
  // ── DASH FLASH (blue) ──
  const dfAmt = Math.max(0, (p.dashFlash || 0) / 400);

  // ── FEET / LEGS (two small ovals peeking below robe) ──
  const footPhase = walk;
  const foot1Y =  isMoving ? Math.sin(footPhase) * 3       : 0;
  const foot2Y =  isMoving ? Math.sin(footPhase + Math.PI) * 3 : 0;
  const foot1X = -r * 0.22;
  const foot2X =  r * 0.22;
  const footColor = shadeColor(p.color, -70);
  // Left foot
  ctx.fillStyle = footColor + 'ee';
  ctx.beginPath(); ctx.ellipse(foot1X, r*0.9 + foot1Y, r*0.2, r*0.13, 0.2, 0, Math.PI*2); ctx.fill();
  // Right foot
  ctx.beginPath(); ctx.ellipse(foot2X, r*0.9 + foot2Y, r*0.2, r*0.13, -0.2, 0, Math.PI*2); ctx.fill();

  // ── ROBE BODY ──
  const robeTop = shadeColor(p.color, -18);
  const robeBot = shadeColor(p.color, -62);
  const robeGrd = ctx.createLinearGradient(-r*0.1, -r*0.15, r*0.1, r*1.05);
  robeGrd.addColorStop(0, robeTop);
  robeGrd.addColorStop(1, robeBot);
  ctx.fillStyle = robeGrd;

  // Robe shape with animated hem
  ctx.beginPath();
  ctx.moveTo(-r*0.7, -r*0.12);
  // Left side curve
  ctx.bezierCurveTo(-r*0.88, r*0.3, -r*0.65, r*0.72, -r*0.42 + hemSway*0.5, r*1.0);
  // Hem (wavy when walking)
  const hmid = hemSway;
  ctx.bezierCurveTo(
    -r*0.2 + hmid, r*1.05 + Math.abs(Math.sin(walk+0.5))*2,
     r*0.2 + hmid, r*1.05 + Math.abs(Math.sin(walk+2.0))*2,
     r*0.42 + hemSway*0.5, r*1.0
  );
  // Right side curve
  ctx.bezierCurveTo(r*0.65, r*0.72, r*0.88, r*0.3, r*0.7, -r*0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = p.color + '88'; ctx.lineWidth = 1.2; ctx.stroke();

  // Robe inner gradient overlay (depth)
  const robeShine = ctx.createRadialGradient(-r*0.15,-r*0.05,0, 0,r*0.3,r*0.9);
  robeShine.addColorStop(0,'rgba(255,255,255,0.14)');
  robeShine.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = robeShine;
  ctx.beginPath();
  ctx.moveTo(-r*0.7,-r*0.12);
  ctx.bezierCurveTo(-r*0.88,r*0.3,-r*0.65,r*0.72,-r*0.42+hemSway*0.5,r*1.0);
  ctx.bezierCurveTo(-r*0.2+hemSway,r*1.05,r*0.2+hemSway,r*1.05,r*0.42+hemSway*0.5,r*1.0);
  ctx.bezierCurveTo(r*0.65,r*0.72,r*0.88,r*0.3,r*0.7,-r*0.12);
  ctx.closePath(); ctx.fill();

  // Robe center seam
  ctx.strokeStyle = p.color + '55'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0,-r*0.1); ctx.lineTo(hmid*0.3, r*0.92); ctx.stroke();

  // Robe collar
  const collarGrd = ctx.createRadialGradient(0,-r*0.1,0,0,-r*0.05,r*0.38);
  collarGrd.addColorStop(0, shadeColor(p.color,10)+'ff');
  collarGrd.addColorStop(1, shadeColor(p.color,-30)+'cc');
  ctx.fillStyle = collarGrd;
  ctx.beginPath(); ctx.ellipse(0,-r*0.1,r*0.36,r*0.14,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=p.color+'aa'; ctx.lineWidth=0.8; ctx.stroke();

  // Robe emblem star
  ctx.save();
  ctx.font = (r*0.55)+'px serif';
  ctx.fillStyle = p.color+'bb';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor=p.color; ctx.shadowBlur=8;
  ctx.fillText('✦', hmid*0.15, r*0.45);
  ctx.restore();

  // ── LEFT SLEEVE (swings forward) ──
  ctx.save();
  ctx.translate(-r*0.72, r*0.1);
  ctx.rotate(armL);
  const sleeveGrdL = ctx.createLinearGradient(0,0,-r*0.1,r*0.45);
  sleeveGrdL.addColorStop(0, shadeColor(p.color,-10)+'ee');
  sleeveGrdL.addColorStop(1, shadeColor(p.color,-50)+'cc');
  ctx.fillStyle = sleeveGrdL;
  ctx.beginPath();
  ctx.ellipse(0, r*0.18, r*0.24, r*0.38, -0.15, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = p.color+'66'; ctx.lineWidth=0.8; ctx.stroke();
  // Cuff
  ctx.fillStyle = shadeColor(p.color,15)+'dd';
  ctx.beginPath(); ctx.ellipse(0, r*0.44, r*0.18, r*0.08, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // ── RIGHT SLEEVE ──
  ctx.save();
  ctx.translate(r*0.72, r*0.1);
  ctx.rotate(armR);
  const sleeveGrdR = ctx.createLinearGradient(0,0,r*0.1,r*0.45);
  sleeveGrdR.addColorStop(0, shadeColor(p.color,-10)+'ee');
  sleeveGrdR.addColorStop(1, shadeColor(p.color,-50)+'cc');
  ctx.fillStyle = sleeveGrdR;
  ctx.beginPath();
  ctx.ellipse(0, r*0.18, r*0.24, r*0.38, 0.15, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = p.color+'66'; ctx.lineWidth=0.8; ctx.stroke();
  // Cuff
  ctx.fillStyle = shadeColor(p.color,15)+'dd';
  ctx.beginPath(); ctx.ellipse(0, r*0.44, r*0.18, r*0.08, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // ── STAFF (rotates to face angle, bobs) ──
  ctx.save();
  ctx.rotate(p.angle);
  const staffBob = isMoving ? Math.sin(walk)*0.12 : Math.sin(idle)*0.04;
  ctx.rotate(staffBob);
  // Shaft
  ctx.strokeStyle = shadeColor(p.color,25)+'cc'; ctx.lineWidth=2.6; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(r*0.5, 0); ctx.lineTo(r*2.1, 0); ctx.stroke();
  // Shaft highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(r*0.55,-1); ctx.lineTo(r*2.05,-1); ctx.stroke();
  // Orb glow (pulses)
  const orbPulse = 1 + Math.sin(idle*2)*0.12 + castGlow*0.4;
  const og = ctx.createRadialGradient(r*2.18,0,0,r*2.18,0,r*0.52*orbPulse);
  og.addColorStop(0,'#ffffff');
  og.addColorStop(0.25, p.color);
  og.addColorStop(1, p.color+'00');
  ctx.fillStyle=og;
  ctx.beginPath(); ctx.arc(r*2.18, 0, r*0.52*orbPulse, 0, Math.PI*2); ctx.fill();
  // Orb core
  ctx.fillStyle='rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(r*2.12,-r*0.06,r*0.11,0,Math.PI*2); ctx.fill();
  // Orb sparkle ring
  ctx.strokeStyle=p.color+'99'; ctx.lineWidth=1;
  ctx.setLineDash([2,3]);
  ctx.beginPath(); ctx.arc(r*2.18,0,r*0.38*orbPulse,0,Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── HEAD ──
  const skinTone = p.id === 0 ? '#f0d5b0' : '#cde8f8';
  const headGrd = ctx.createRadialGradient(-r*0.1,-r*0.55,0, 0,-r*0.44,r*0.38);
  headGrd.addColorStop(0,'#ffffff55');
  headGrd.addColorStop(0.2, skinTone);
  headGrd.addColorStop(1, shadeColor(skinTone,-30));
  ctx.fillStyle=headGrd;
  ctx.beginPath(); ctx.arc(0,-r*0.44,r*0.37,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=shadeColor(skinTone,-40)+'77'; ctx.lineWidth=0.8; ctx.stroke();

  // Cheek blush
  ctx.fillStyle=p.id===0?'rgba(255,160,100,0.2)':'rgba(120,200,255,0.2)';
  ctx.beginPath(); ctx.ellipse(-r*0.2,-r*0.42,r*0.1,r*0.07,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( r*0.2,-r*0.42,r*0.1,r*0.07,0,0,Math.PI*2); ctx.fill();

  // Eyes — blink every ~3s
  const blinkCycle = Math.sin(idle * 0.18);
  const eyeH = blinkCycle > 0.97 ? r*0.02 : r*0.09;
  ctx.fillStyle='#0d0520';
  ctx.beginPath(); ctx.ellipse(-r*0.13,-r*0.48,r*0.075,eyeH,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( r*0.13,-r*0.48,r*0.075,eyeH,0,0,Math.PI*2); ctx.fill();
  // Eye glow
  if (blinkCycle <= 0.97) {
    ctx.fillStyle=p.color+'ee';
    ctx.beginPath(); ctx.ellipse(-r*0.13,-r*0.49,r*0.042,r*0.055,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse( r*0.13,-r*0.49,r*0.042,r*0.055,0,0,Math.PI*2); ctx.fill();
  }
  // Eye shine
  ctx.fillStyle='rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(-r*0.15,-r*0.51,r*0.025,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( r*0.11,-r*0.51,r*0.025,0,Math.PI*2); ctx.fill();

  // Eyebrows (raise when casting)
  const browRaise = castGlow * r * 0.06;
  ctx.strokeStyle=p.id===0?'#7a5530':'#3a6a80'; ctx.lineWidth=1.3; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(-r*0.13,-r*0.56-browRaise,r*0.1,Math.PI+0.35,Math.PI*2-0.35); ctx.stroke();
  ctx.beginPath(); ctx.arc( r*0.13,-r*0.56-browRaise,r*0.1,Math.PI+0.35,Math.PI*2-0.35); ctx.stroke();

  // Nose
  ctx.fillStyle=shadeColor(skinTone,-22)+'cc';
  ctx.beginPath(); ctx.ellipse(0,-r*0.38,r*0.04,r*0.055,0,0,Math.PI*2); ctx.fill();

  // Mouth (smirk / open when casting)
  ctx.strokeStyle=shadeColor(skinTone,-45)+'cc'; ctx.lineWidth=1; ctx.lineCap='round';
  if (castGlow > 0.3) {
    ctx.fillStyle=shadeColor(skinTone,-55)+'cc';
    ctx.beginPath(); ctx.ellipse(0,-r*0.3,r*0.09,r*0.06,0,0,Math.PI*2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0,-r*0.28,r*0.09,0.15,Math.PI-0.15); ctx.stroke();
  }

  // ── MUSTACHE ──
  const mustacheColor = p.id===0?'rgba(230,215,190,0.9)':'rgba(170,220,245,0.9)';
  ctx.fillStyle=mustacheColor;
  ctx.beginPath(); ctx.ellipse(-r*0.1,-r*0.33,r*0.13,r*0.057,-0.28,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( r*0.1,-r*0.33,r*0.13,r*0.057, 0.28,0,Math.PI*2); ctx.fill();

  // ── BEARD (sways with walk) ──
  ctx.save();
  ctx.translate(beardSway*0.3, 0);
  const beardGrd = ctx.createLinearGradient(0,-r*0.28,0,r*0.32);
  beardGrd.addColorStop(0, mustacheColor);
  beardGrd.addColorStop(1, p.id===0?'rgba(210,200,175,0.7)':'rgba(150,210,240,0.7)');
  ctx.fillStyle=beardGrd;
  ctx.beginPath();
  ctx.moveTo(-r*0.2,-r*0.26);
  ctx.bezierCurveTo(-r*0.3+beardSway*0.2, r*0.0, -r*0.22+beardSway*0.3, r*0.22, 0,r*0.32);
  ctx.bezierCurveTo(  r*0.22-beardSway*0.3,r*0.22,  r*0.3-beardSway*0.2, r*0.0,  r*0.2,-r*0.26);
  ctx.closePath(); ctx.fill();
  // Beard strands
  ctx.strokeStyle= p.id===0?'rgba(245,235,210,0.4)':'rgba(185,230,255,0.4)';
  ctx.lineWidth=0.8;
  for (let s=-1; s<=1; s++) {
    ctx.beginPath();
    ctx.moveTo(s*r*0.07,-r*0.22);
    ctx.quadraticCurveTo(s*r*0.12+beardSway*0.2, r*0.05, s*r*0.04+beardSway*0.3, r*0.28);
    ctx.stroke();
  }
  ctx.restore();

  // ── WIZARD HAT ──
  ctx.save();
  ctx.rotate(hatTilt);

  // Hat shadow/depth
  const hatBot = shadeColor(p.color,-50);
  const hatMid = shadeColor(p.color,-22);
  const hatGrd = ctx.createLinearGradient(-r*0.35,-r*1.65,r*0.35,-r*0.68);
  hatGrd.addColorStop(0, p.color);
  hatGrd.addColorStop(0.55, hatMid);
  hatGrd.addColorStop(1, hatBot);
  ctx.fillStyle=hatGrd;

  // Hat shape
  ctx.beginPath();
  ctx.moveTo(-r*0.44,-r*0.7);
  ctx.bezierCurveTo(-r*0.3,-r*0.82, -r*0.12,-r*1.2, -r*0.065,-r*1.65);
  ctx.lineTo(r*0.065,-r*1.65);
  ctx.bezierCurveTo(r*0.12,-r*1.2, r*0.3,-r*0.82, r*0.44,-r*0.7);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle=p.color+'99'; ctx.lineWidth=1; ctx.stroke();

  // Hat shine stripe
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1.5; ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(-r*0.25,-r*0.8);
  ctx.bezierCurveTo(-r*0.18,-r*1.05,-r*0.08,-r*1.35,-r*0.04,-r*1.55);
  ctx.stroke();

  // Hat brim
  const brimGrd = ctx.createLinearGradient(0,-r*0.78,0,-r*0.64);
  brimGrd.addColorStop(0,shadeColor(p.color,-12)+'ff');
  brimGrd.addColorStop(1,shadeColor(p.color,-48)+'ee');
  ctx.fillStyle=brimGrd;
  ctx.beginPath(); ctx.ellipse(0,-r*0.72,r*0.57,r*0.15,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=p.color+'99'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.ellipse(0,-r*0.72,r*0.57,r*0.15,0,0,Math.PI*2); ctx.stroke();
  // Brim highlight
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.ellipse(0,-r*0.69,r*0.45,r*0.08,0,-0.3,Math.PI+0.3); ctx.stroke();

  // Hat band
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0,-r*0.77,r*0.43,r*0.1,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=p.color+'66'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.ellipse(0,-r*0.77,r*0.43,r*0.1,0,0,Math.PI*2); ctx.stroke();

  // Star badge on hat (rotates slowly)
  ctx.save();
  ctx.translate(r*0.22,-r*1.0);
  ctx.rotate(idle*0.3);
  ctx.font=(r*0.32)+'px serif';
  ctx.fillStyle='rgba(255,220,60,0.95)';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='#ffdd44'; ctx.shadowBlur=7;
  ctx.fillText('★',0,0);
  ctx.restore();

  // Hat tip glow (pulses)
  const tipPulse = 0.25 + Math.sin(idle*1.8)*0.06 + castGlow*0.5;
  const tipG = ctx.createRadialGradient(0,-r*1.65,0,0,-r*1.65,r*tipPulse*1.8);
  tipG.addColorStop(0,p.color+'dd');
  tipG.addColorStop(1,p.color+'00');
  ctx.fillStyle=tipG;
  ctx.beginPath(); ctx.arc(0,-r*1.65,r*tipPulse*1.8,0,Math.PI*2); ctx.fill();

  ctx.restore(); // hat rotation

  // ── WHITE HIT FLASH overlay ──
  if (hitF > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    // Draw full wizard silhouette in white
    // Robe
    ctx.fillStyle = `rgba(255,255,255,${hitF * 0.92})`;
    ctx.beginPath();
    ctx.moveTo(-r*0.7, -r*0.12);
    ctx.bezierCurveTo(-r*0.88, r*0.3, -r*0.65, r*0.72, -r*0.42, r*1.0);
    ctx.bezierCurveTo(-r*0.1, r*1.06, r*0.1, r*1.06, r*0.42, r*1.0);
    ctx.bezierCurveTo(r*0.65, r*0.72, r*0.88, r*0.3, r*0.7, -r*0.12);
    ctx.closePath(); ctx.fill();
    // Head
    ctx.beginPath(); ctx.arc(0,-r*0.44,r*0.37,0,Math.PI*2); ctx.fill();
    // Hat
    ctx.beginPath();
    ctx.moveTo(-r*0.44,-r*0.7);
    ctx.bezierCurveTo(-r*0.3,-r*0.82,-r*0.12,-r*1.2,-r*0.065,-r*1.65);
    ctx.lineTo(r*0.065,-r*1.65);
    ctx.bezierCurveTo(r*0.12,-r*1.2,r*0.3,-r*0.82,r*0.44,-r*0.7);
    ctx.closePath(); ctx.fill();
    // Left sleeve
    ctx.beginPath(); ctx.ellipse(-r*0.88, r*0.18, r*0.26, r*0.42, armL, 0, Math.PI*2); ctx.fill();
    // Right sleeve
    ctx.beginPath(); ctx.ellipse(r*0.88, r*0.18, r*0.26, r*0.42, armR, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // outer white glow ring
    ctx.save();
    const hg = ctx.createRadialGradient(0,0,r*0.5,0,0,r*2.8);
    hg.addColorStop(0,`rgba(255,255,255,${hitF*0.45})`);
    hg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0,0,r*2.8,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // ── BLUE DASH FLASH overlay ──
  if (dfAmt > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(80,190,255,${dfAmt * 0.88})`;
    // Robe silhouette
    ctx.beginPath();
    ctx.moveTo(-r*0.7, -r*0.12);
    ctx.bezierCurveTo(-r*0.88, r*0.3, -r*0.65, r*0.72, -r*0.42, r*1.0);
    ctx.bezierCurveTo(-r*0.1, r*1.06, r*0.1, r*1.06, r*0.42, r*1.0);
    ctx.bezierCurveTo(r*0.65, r*0.72, r*0.88, r*0.3, r*0.7, -r*0.12);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0,-r*0.44,r*0.37,0,Math.PI*2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r*0.44,-r*0.7);
    ctx.bezierCurveTo(-r*0.3,-r*0.82,-r*0.12,-r*1.2,-r*0.065,-r*1.65);
    ctx.lineTo(r*0.065,-r*1.65);
    ctx.bezierCurveTo(r*0.12,-r*1.2,r*0.3,-r*0.82,r*0.44,-r*0.7);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // Blue speed-line streaks
    ctx.save();
    ctx.globalAlpha = dfAmt * 0.7;
    ctx.rotate(p.angle + Math.PI); // streaks going backward
    for (let li = 0; li < 6; li++) {
      const ly = (li - 2.5) * r * 0.28;
      const llen = (0.6 + Math.random()*0.4) * r * 1.8 * dfAmt;
      const lg = ctx.createLinearGradient(0, 0, llen, 0);
      lg.addColorStop(0, 'rgba(80,190,255,0.9)');
      lg.addColorStop(1, 'rgba(80,190,255,0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.5 - li*0.15;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(r*0.3, ly); ctx.lineTo(r*0.3 + llen, ly); ctx.stroke();
    }
    ctx.restore();
  }

  // ── DAMAGE % label ──
  const dmgColor = p.damage>80?'#ff3300':p.damage>40?'#ffaa00':'rgba(255,255,255,0.82)';
  ctx.save();
  ctx.rotate(-leanX); // keep label upright
  ctx.fillStyle=dmgColor;
  ctx.font='bold 9px Cinzel, serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor=dmgColor; ctx.shadowBlur=7;
  ctx.fillText(Math.round(p.damage)+'%', 0, -r*2.15);
  ctx.restore();

  ctx.restore(); // main translate
}

function getSkillAimRange(spellName) {
  if (spellName === 'lightning') return SPELLS.lightning.range || 280;
  if (spellName === 'gravity') return 220;
  if (spellName === 'thrust') return 150;
  if (spellName === 'shield') return 70;
  if (spellName === 'meteor') return 240;
  return 230;
}

function drawAimReticle(x, y, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 22, y);
  ctx.lineTo(x - 9, y);
  ctx.moveTo(x + 9, y);
  ctx.lineTo(x + 22, y);
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x, y - 9);
  ctx.moveTo(x, y + 9);
  ctx.lineTo(x, y + 22);
  ctx.stroke();
  ctx.restore();
}

function drawSimpleBossSprite(boss) {
  const r = boss.radius;
  const pulse = 0.88 + Math.sin(performance.now() * 0.006) * 0.08;
  ctx.save();
  ctx.translate(boss.x, boss.y);
  if (boss.dead) {
    ctx.rotate(boss.deathSpin || 0);
    ctx.globalAlpha = Math.max(0, (boss.deadTimer || 0) / 2000);
    if ((boss.deadTimer || 0) <= 0) { ctx.restore(); return; }
  }
  ctx.fillStyle = boss.rageMode ? 'rgba(255,0,150,0.18)' : 'rgba(210,20,80,0.14)';
  ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = boss.rageMode ? '#7a0f3f' : '#5a1630';
  ctx.beginPath(); ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = boss.rageMode ? '#ff4cb5' : '#ff6b35';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffd7ef';
  ctx.beginPath(); ctx.arc(-r * 0.28, -r * 0.14, r * 0.11 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.28, -r * 0.14, r * 0.11 * pulse, 0, Math.PI * 2); ctx.fill();
  if (boss.rageMode) {
    ctx.beginPath(); ctx.arc(0, -r * 0.42, r * 0.1 * pulse, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.35, r * 0.22);
  ctx.quadraticCurveTo(0, r * 0.56, r * 0.35, r * 0.22);
  ctx.stroke();
  ctx.fillStyle = boss.rageMode ? '#ff4cb5' : '#ff8c42';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * r * 0.24, -r * 1.08);
    ctx.lineTo(i * r * 0.08, -r * 0.7);
    ctx.lineTo(i * r * 0.4, -r * 0.72);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTouchSkillAim() {
  if (!activeSkillAim || inputMode !== 'touch' || players[0].dead) return;
  const player = players[0];
  const spell = SPELLS[activeSkillAim.spell];
  if (!spell) return;
  const range = getSkillAimRange(activeSkillAim.spell);
  const tx = player.x + activeSkillAim.dx * range;
  const ty = player.y + activeSkillAim.dy * range;
  const ang = Math.atan2(activeSkillAim.dy, activeSkillAim.dx);
  const aimColor = 'rgba(255,220,140,0.95)';
  const fillColor = 'rgba(255,180,80,0.14)';
  const isLinearSpell = !['gravity', 'meteor', 'shield'].includes(activeSkillAim.spell);

  ctx.save();
  ctx.strokeStyle = aimColor;
  ctx.fillStyle = fillColor;
  ctx.shadowColor = aimColor;
  ctx.shadowBlur = lowFxMode ? 0 : 16;
  if (isLinearSpell) {
    const len = Math.hypot(tx - player.x, ty - player.y);
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(ang);
    if (!lowFxMode) {
      const beamGrad = ctx.createLinearGradient(0, 0, len, 0);
      beamGrad.addColorStop(0, 'rgba(255,230,180,0.92)');
      beamGrad.addColorStop(0.55, 'rgba(255,180,80,0.45)');
      beamGrad.addColorStop(1, 'rgba(255,180,80,0.08)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.rect(0, -7, len, 14);
      ctx.fill();
    }
    ctx.strokeStyle = aimColor;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([14, 8]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (activeSkillAim.spell === 'gravity') {
    ctx.beginPath();
    ctx.arc(tx, ty, spell.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawAimReticle(tx, ty, aimColor);
  } else if (activeSkillAim.spell === 'meteor') {
    ctx.beginPath();
    ctx.arc(tx, ty, spell.aoeRadius || 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawAimReticle(tx, ty, aimColor);
  } else if (activeSkillAim.spell === 'shield') {
    ctx.beginPath();
    ctx.arc(player.x, player.y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawAimReticle(player.x + Math.cos(ang) * 42, player.y + Math.sin(ang) * 42, aimColor);
  } else {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-10, -9);
    ctx.lineTo(-10, 9);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,220,140,0.75)';
    ctx.fill();
    ctx.restore();
    drawAimReticle(tx, ty, aimColor);
  }
  ctx.restore();
}

function drawProjectiles() {
  projectiles.forEach(proj => {
    ctx.save();
    if (lowFxMode) {
      ctx.fillStyle = proj.color;
      ctx.beginPath(); ctx.arc(proj.x, proj.y, proj.radius * 1.6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, Math.max(1.5, proj.radius * 0.35), 0, Math.PI*2); ctx.fill();
      ctx.restore();
      return;
    }
    const g = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, proj.radius * 2.5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, proj.color);
    g.addColorStop(1, proj.glow + '00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(proj.x, proj.y, proj.radius * 2.5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(proj.x, proj.y, proj.radius * 0.5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

function drawEffects() {
  effects.forEach(e => {
    if (e.type === 'lightning') {
      ctx.save();
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 3;
      ctx.shadowColor = e.glow;
      ctx.shadowBlur = lowFxMode ? 0 : 20;
      ctx.globalAlpha = e.life / 16;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      // Zigzag
      const segs = lowFxMode ? 4 : 8;
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const jitter = lowFxMode ? 8 : 20;
        const mx = e.x1 + (e.x2 - e.x1) * t + (Math.random()-0.5)*jitter;
        const my = e.y1 + (e.y2 - e.y1) * t + (Math.random()-0.5)*jitter;
        ctx.lineTo(mx, my);
      }
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.restore();
    }
    if (e.type === 'explosion') {
      const ep = e.life / e.maxLife;
      ctx.save();
      ctx.globalAlpha = ep * 0.8;
      if (lowFxMode) {
        ctx.fillStyle = e.color;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.radius * (1.05 - ep * 0.2), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      const eg = ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,e.radius*(1.2-ep*0.5));
      eg.addColorStop(0,'rgba(255,200,80,0.9)');
      eg.addColorStop(0.4, e.color+'cc');
      eg.addColorStop(1, e.color+'00');
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(e.x,e.y,e.radius*(1.2-ep*0.3),0,Math.PI*2); ctx.fill();
      ctx.restore();
    }
    if (e.type === 'gravity') {
      const pct = e.life / e.maxLife;
      ctx.save();
      ctx.globalAlpha = pct * 0.6;
      for (let r = 20; r <= e.radius; r += lowFxMode ? 26 : 18) {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * pct, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (e.type === 'bossLaser') {
      const pct  = e.life / e.maxLife;
      const w2   = ((e.width || 60) * 0.5) * (0.5 + 0.5*pct);
      const llen = Math.hypot(e.x2-e.x1, e.y2-e.y1);
      const lang = Math.atan2(e.y2-e.y1, e.x2-e.x1);
      ctx.save();
      ctx.translate(e.x1, e.y1);
      ctx.rotate(lang);
      if (lowFxMode) {
        ctx.globalAlpha = pct;
        ctx.fillStyle = e.isRage ? 'rgba(255,90,240,0.8)' : 'rgba(255,120,40,0.85)';
        ctx.beginPath(); ctx.rect(0, -w2, llen, w2 * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.rect(0, -w2 * 0.14, llen, w2 * 0.28); ctx.fill();
        ctx.restore();
        e.life--;
        return;
      }
      // Wide glow aura
      const grdA = ctx.createLinearGradient(0, 0, llen, 0);
      grdA.addColorStop(0,   e.isRage ? 'rgba(255,0,220,0.9)'  : 'rgba(255,30,80,0.9)');
      grdA.addColorStop(0.5, e.isRage ? 'rgba(180,0,255,0.5)'  : 'rgba(255,120,0,0.5)');
      grdA.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.shadowColor = e.isRage ? '#ff00ff' : '#ff4400';
      ctx.shadowBlur  = 40;
      ctx.globalAlpha = pct;
      ctx.fillStyle   = grdA;
      ctx.beginPath(); ctx.rect(0, -w2*3, llen, w2*6); ctx.fill();
      // Mid beam
      const grdB = ctx.createLinearGradient(0, 0, llen, 0);
      grdB.addColorStop(0,   e.isRage ? 'rgba(255,100,255,0.95)' : 'rgba(255,220,50,0.95)');
      grdB.addColorStop(0.6, e.isRage ? 'rgba(200,50,255,0.7)'   : 'rgba(255,80,0,0.7)');
      grdB.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.shadowBlur = 20;
      ctx.fillStyle = grdB;
      ctx.beginPath(); ctx.rect(0, -w2, llen, w2*2); ctx.fill();
      // Core white line
      ctx.fillStyle = 'rgba(255,255,255,' + (pct * 0.98) + ')';
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 25;
      ctx.beginPath(); ctx.rect(0, -w2*0.15, llen, w2*0.3); ctx.fill();
      // Sparkle bolts along beam
      ctx.strokeStyle = e.isRage ? 'rgba(255,150,255,0.7)' : 'rgba(255,255,100,0.6)';
      ctx.lineWidth = 1.5;
      for (let si = 0; si < 5; si++) {
        const bx = llen * (0.1 + si*0.18);
        ctx.beginPath();
        ctx.moveTo(bx, -w2*(0.5+Math.random()*1.5));
        ctx.lineTo(bx + (Math.random()-0.5)*20, 0);
        ctx.lineTo(bx + (Math.random()-0.5)*10, w2*(0.5+Math.random()*1.5));
        ctx.stroke();
      }
      ctx.restore();
      e.life--;
    }
  });
}

function drawParticles() {
  const visibleParticles = lowFxMode && particles.length > MAX_PARTICLES
    ? particles.slice(particles.length - MAX_PARTICLES)
    : particles;
  visibleParticles.forEach(pt => {
    const alpha = pt.life / (pt.maxLife || 60);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (pt.type === 'dot') {
      ctx.fillStyle = pt.color;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = lowFxMode ? 0 : 8;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.radius * alpha, 0, Math.PI*2); ctx.fill();
    } else if (pt.type === 'text') {
      ctx.fillStyle = pt.color;
      ctx.font = 'bold 13px Cinzel, serif';
      ctx.textAlign = 'center';
      ctx.fillText(pt.text, pt.x, pt.y);
    }
    ctx.restore();
  });
}

function shadeColor(hex, pct) {
  // Always returns a #rrggbb hex string so hex-alpha suffixes (e.g. +'cc') work
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n>>16) + pct));
  const g = Math.min(255, Math.max(0, ((n>>8)&0xff) + pct));
  const b = Math.min(255, Math.max(0, (n&0xff) + pct));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

// ─────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────
let lastTime = 0;
function loop(ts) {
  const dt = Math.min(ts - lastTime, 50); lastTime = ts;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Deep background
  ctx.fillStyle = '#07000f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── Smooth camera follow player 0 (or spectator target) ──
  let targetCamX, targetCamY;
  if (spectatorMode && spectatorTarget) {
    targetCamX = spectatorTarget.x;
    targetCamY = spectatorTarget.y;
  } else {
    targetCamX = players[0].dead ? camX : players[0].x;
    targetCamY = players[0].dead ? camY : players[0].y;
  }
  const camLerp = 0.1;
  camX += (targetCamX - camX) * camLerp;
  camY += (targetCamY - camY) * camLerp;

  const cx = canvas.width  / 2 - camX;
  const cy = canvas.height / 2 - camY;

  // Stars (parallax — scroll at 20% of camera speed)
  const starPX = camX * 0.2;
  const starPY = camY * 0.2;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < STAR_COUNT; i++) {
    const sx = ((i * 137.5 + starPX) % canvas.width + canvas.width) % canvas.width;
    const sy = ((i * 97.3  + starPY) % canvas.height + canvas.height) % canvas.height;
    const ss = 0.5 + (i % 3) * 0.4;
    ctx.fillRect(sx, sy, ss, ss);
  }

  computeArena();

  // ── Countdown tick ──
  if (countdownVal > 0) {
    const elapsed = ts - countdownTime;
    if (elapsed >= 1000) {
      countdownVal--;
      countdownTime = ts;
      SFX.countdownBeep(countdownVal);
      if (countdownVal === 0) {
        gameRunning = true;
        lavaLastTime = ts;
        setTimeout(() => SFX.roundStart(), 200);
      }
    }
  }

  // ── Screen shake ──
  if (screenShake > 0) {
    screenShake *= 0.85;
    if (screenShake < 0.5) screenShake = 0;
  }
  const shakeX = screenShake > 0 ? (Math.random()-0.5)*screenShake*2 : 0;
  const shakeY = screenShake > 0 ? (Math.random()-0.5)*screenShake*2 : 0;

  // ── Apply camera transform for all world elements ──
  ctx.save();
  ctx.translate(cx + shakeX, cy + shakeY);

  drawArena();

  if ((gameRunning || spectatorMode) && (!onlineMode || onlineRole === 'host')) {
    updatePhysics(ts, dt);
    players.forEach(p => {
      if (p.isBoss) updateBoss(p, dt, ts);
      else if (p.isBot) updateBot(p, dt);
    });
    // Boss lava check: keep boss inside arena (don't die from lava)
    if (bossPlayer && !bossPlayer.dead) {
      const bd = Math.hypot(bossPlayer.x - arenaX, bossPlayer.y - arenaY);
      if (bd > arenaR * (lavaRadius||1) - bossPlayer.radius - 10) {
        // Push boss back inward
        const ba = Math.atan2(bossPlayer.y - arenaY, bossPlayer.x - arenaX);
        bossPlayer.vx -= Math.cos(ba) * 2;
        bossPlayer.vy -= Math.sin(ba) * 2;
      }
    }
    if (spectatorMode) updateSpectator(dt);
  }
  if (onlineMode && onlineRole === 'guest' && gameRunning) {
    sendGuestInput();
  }
  if (onlineMode && onlineRole === 'host' && roomRefs.state && gameRunning) {
    onlineSnapshotTimer -= dt;
    if (onlineSnapshotTimer <= 0) {
      onlineSnapshotTimer = ONLINE_STATE_SYNC_MS;
      roomRefs.state.set(serializeOnlineState());
    }
  }

  drawLaserTelegraphs();
  drawTouchSkillAim();
  drawEffects();
  drawProjectiles();
  players.forEach(drawWarlock);
  if (bossPlayer && !bossPlayer.dead) drawBossHpBar(bossPlayer);
  drawParticles();

  ctx.restore();
  // ── End camera transform ──

  // ── Spectator overlay ──
  if (spectatorMode) {
    ctx.save();
    // Dark vignette top
    const vg = ctx.createLinearGradient(0, 0, 0, 90);
    vg.addColorStop(0, 'rgba(0,0,0,0.6)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, canvas.width, 90);

    // SPECTATING label
    ctx.font = 'bold 11px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('SPECTATING', canvas.width / 2, 10);

    // Target name pill
    if (spectatorTarget) {
      const name = spectatorTarget.name.toUpperCase();
      const pillW = 130, pillH = 26;
      const px = canvas.width / 2 - pillW / 2;
      const py = 28;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 13); ctx.fill();
      ctx.strokeStyle = spectatorTarget.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 13); ctx.stroke();
      // Color dot
      ctx.fillStyle = spectatorTarget.color;
      ctx.beginPath(); ctx.arc(px + 18, py + pillH/2, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 10px Cinzel, serif';
      ctx.textAlign = 'left';
      ctx.fillText(name, px + 30, py + 7);
      // Lives dots
      ctx.textAlign = 'left';
      for (let i = 0; i < spectatorTarget.lives; i++) {
        ctx.fillStyle = spectatorTarget.color;
        ctx.beginPath(); ctx.arc(px + 30 + i * 10, py + pillH - 7, 3, 0, Math.PI*2); ctx.fill();
      }
    }

    // Bottom tip
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Waiting for round to end...', canvas.width / 2, canvas.height - 8);
    ctx.restore();
  }

  // ── Countdown overlay ──
  if (countdownVal > 0) {
    const elapsed = ts - countdownTime;
    const prog    = elapsed / 1000; // 0→1 within each second
    const scale   = 1.5 - prog * 0.5;  // shrinks from big to normal
    const alpha   = prog < 0.7 ? 1 : 1 - (prog - 0.7) / 0.3;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.round(canvas.height * 0.18 * scale)}px Cinzel Decorative, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Glow
    ctx.shadowColor = countdownVal === 1 ? '#ff4400' : '#ffd700';
    ctx.shadowBlur  = 40;
    ctx.fillStyle   = countdownVal === 1 ? '#ff6b35' : '#ffd700';
    ctx.fillText(countdownVal, canvas.width / 2, canvas.height / 2);
    ctx.restore();
  } else if (countdownVal === 0 && ts - countdownTime < 800) {
    // "GO!" flash
    const prog  = (ts - countdownTime) / 800;
    const alpha = 1 - prog;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.round(canvas.height * 0.14)}px Cinzel Decorative, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#88ff44'; ctx.shadowBlur = 50;
    ctx.fillStyle   = '#aaff55';
    ctx.fillText('GO!', canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }

  updateHUD();

  // roundRect polyfill for older browsers
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    this.beginPath();
    this.moveTo(x+r,y); this.arcTo(x+w,y,x+w,y+h,r); this.arcTo(x+w,y+h,x,y+h,r);
    this.arcTo(x,y+h,x,y,r); this.arcTo(x,y,x+w,y,r); this.closePath();
  };
}
requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// SHOP SYSTEM
// ─────────────────────────────────────────────
const SPELL_ICONS = { fireball:'🔥', lightning:'⚡', homing:'💙', shield:'🛡️', thrust:'💨', gravity:'🌀', meteor:'☄️', icebolt:'🧊' };


// ─────────────────────────────────────────────
// SPELL LEVEL SYSTEM
// ─────────────────────────────────────────────
function getSpellLevel(spell) {
  return (players[0].spellLevels && players[0].spellLevels[spell]) || 1;
}

function upgradeSpellLevel(spellName, levelData) {
  if (!players[0].spellLevels) players[0].spellLevels = {};
  const lvl = getSpellLevel(spellName) + 1;
  players[0].spellLevels[spellName] = lvl;
  if (levelData.fn) levelData.fn(SPELLS[spellName]);
}

function buildShopUpgradeCards() {
  const p = players[0];
  const cards = [];

  // Fireball upgrades
  if (p.activeSpells.includes('fireball')) {
    const curLvl = getSpellLevel('fireball');
    if (curLvl < FIREBALL_LEVELS.length - 1) {
      const next = FIREBALL_LEVELS[curLvl + 1];
      cards.push({ id:'lvl_fireball', name:`Fireball Lv${curLvl}→${curLvl+1}`, icon:'🔥',
        cost:next.cost, type:'spell_upgrade', spell:'fireball', desc:next.desc, nextLevel:curLvl+1 });
    }
  }

  // Lightning upgrades
  if (p.activeSpells.includes('lightning')) {
    const curLvl = getSpellLevel('lightning');
    if (curLvl < LIGHTNING_LEVELS.length - 1) {
      const next = LIGHTNING_LEVELS[curLvl + 1];
      cards.push({ id:'lvl_lightning', name:`Lightning Lv${curLvl}→${curLvl+1}`, icon:'⚡',
        cost:next.cost, type:'spell_upgrade', spell:'lightning', desc:next.desc, nextLevel:curLvl+1 });
    }
  }

  return cards;
}

function showShop() {
  shopOpen = true;
  runBotShop();
  const panel = document.getElementById('shopPanel');
  panel.style.display = 'flex';

  // Update gold
  document.getElementById('shop-gold-display').textContent = `💰 ${playerGold}g`;

  // Active spells chips
  const activeCont = document.getElementById('shop-active-spells');
  activeCont.innerHTML = (players[0].activeSpells || []).map(s =>
    `<div class="active-spell-chip">${SPELL_ICONS[s]||'✨'} ${s}</div>`
  ).join('');

  // Spell shop
  const spellGrid = document.getElementById('shop-spells-grid');
  const newSpells = SHOP_ITEMS.filter(i => i.type === 'spell');
  spellGrid.innerHTML = newSpells.map(item => {
    const owned = (players[0].activeSpells || []).includes(item.id);
    const canAfford = playerGold >= item.cost;
    let cls = 'shop-card';
    if (owned) cls += ' owned';
    else if (canAfford) cls += ' affordable';
    else cls += ' cant-afford';
    return `<div class="${cls}" data-item="${item.id}">
      ${owned ? '<span class="shop-owned-badge">✓</span>' : ''}
      <span class="shop-icon">${item.icon}</span>
      <span class="shop-name">${item.name}</span>
      <span class="shop-desc">${item.desc}</span>
      <span class="shop-cost${owned?' free':''}">${owned ? 'OWNED' : item.cost+'g'}</span>
    </div>`;
  }).join('');

  // Upgrades shop (level-based + classic)
  const upgGrid = document.getElementById('shop-upgrades-grid');
  const levelCards = buildShopUpgradeCards();
  const classicUpgs = SHOP_ITEMS.filter(i => i.type === 'upgrade' && !['upg_fireball','upg_lightning'].includes(i.id));
  const allUpgItems = [...levelCards, ...classicUpgs];
  upgGrid.innerHTML = allUpgItems.map(item => {
    const hasSpell = item.spell ? (players[0].activeSpells || []).includes(item.spell) : true;
    if (!hasSpell) return '';
    if (item.type === 'upgrade') {
      const alreadyUpg = players[0].upgrades && players[0].upgrades[item.id];
      const canAfford = playerGold >= item.cost;
      let cls = 'shop-card' + (alreadyUpg ? ' owned' : canAfford ? ' affordable' : ' cant-afford');
      return `<div class="${cls}" data-item="${item.id}" data-type="upgrade">
        ${alreadyUpg ? '<span class="shop-owned-badge">✓</span>' : ''}
        <span class="shop-icon">${item.icon}</span>
        <span class="shop-name">${item.name}</span>
        <span class="shop-desc">${item.desc}</span>
        <span class="shop-cost${alreadyUpg?' free':''}">${alreadyUpg ? 'DONE' : item.cost+'g'}</span>
      </div>`;
    } else { // spell_upgrade (leveled)
      const canAfford = playerGold >= item.cost;
      let cls = 'shop-card' + (canAfford ? ' affordable' : ' cant-afford');
      return `<div class="${cls}" data-item="${item.id}" data-type="spell_upgrade" data-spell="${item.spell}">
        <span class="shop-icon">${item.icon}</span>
        <span class="shop-name">${item.name}</span>
        <span class="shop-desc">${item.desc}</span>
        <span class="shop-cost">${item.cost}g</span>
      </div>`;
    }
  }).join('');

  // Bind clicks
  panel.querySelectorAll('.shop-card').forEach(card => {
    const handler = () => {
      if (card.dataset.type === 'spell_upgrade') buySpellLevel(card.dataset.spell);
      else buyItem(card.dataset.item);
    };
    card.addEventListener('click', handler);
    card.addEventListener('touchend', (e) => { e.preventDefault(); handler(); });
  });
}


function buySpellLevel(spellName) {
  const curLvl = getSpellLevel(spellName);
  const levelArr = spellName === 'fireball' ? FIREBALL_LEVELS : LIGHTNING_LEVELS;
  if (curLvl >= levelArr.length - 1) return; // max level
  const next = levelArr[curLvl + 1];
  if (playerGold < next.cost) return;
  playerGold -= next.cost;
  // Add spell to active if not already (e.g. buying lightning lv2 when you first get lightning)
  if (!players[0].activeSpells.includes(spellName)) players[0].activeSpells.push(spellName);
  upgradeSpellLevel(spellName, next);
  showShop();
}

function buyItem(itemId) {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return;

  if (item.type === 'spell') {
    if ((players[0].activeSpells || []).includes(item.id)) return; // already owned
    if (playerGold < item.cost) return;
    if (!players[0].activeSpells) players[0].activeSpells = [];
    if (players[0].activeSpells.length < 6) {
      // Slot available — buy immediately
      playerGold -= item.cost;
      players[0].activeSpells.push(item.id);
      showShop();
    } else {
      // All 6 slots full — show swap UI (deduct gold after confirm)
      showSwapModal(item);
    }
    return;
  } else if (item.type === 'upgrade') {
    if (players[0].upgrades && players[0].upgrades[item.id]) return; // already done
    if (playerGold < item.cost) return;
    playerGold -= item.cost;
    if (!players[0].upgrades) players[0].upgrades = {};
    players[0].upgrades[item.id] = true;
    // Apply upgrade effect
    applyUpgrade(item.id);
  }
  showShop();
}

function applyUpgrade(upg) {
  const p = players[0];
  if (upg === 'upg_fireball')  { SPELLS.fireball.damage += 12; SPELLS.fireball.cd = Math.round(SPELLS.fireball.cd * 0.8); }
  if (upg === 'upg_lightning') { SPELLS.lightning.damage += 20; SPELLS.lightning.cd = Math.round(SPELLS.lightning.cd * 0.8); }
  if (upg === 'upg_homing')    { SPELLS.homing.damage += 15; SPELLS.homing.cd = Math.round(SPELLS.homing.cd * 0.8); }
  if (upg === 'upg_thrust')    { SPELLS.thrust.dashSpeed *= 1.5; }
  if (upg === 'upg_shield')    { SPELLS.shield.duration += 1500; }
  if (upg === 'upg_speed')     { ['fireball','homing','meteor','icebolt'].forEach(s => { if(SPELLS[s]&&SPELLS[s].speed) SPELLS[s].speed *= 1.3; }); }
}


let pendingSwapItem = null;

function showSwapModal(item) {
  pendingSwapItem = item;
  const modal = document.getElementById('swapModal');
  document.getElementById('swap-new-name').textContent = item.name + ' (' + item.cost + 'g)';
  const slotsEl = document.getElementById('swap-slots');
  const ICON = { fireball:'🔥', lightning:'⚡', homing:'💙', shield:'🛡️', thrust:'💨', gravity:'🌀', meteor:'☄️', icebolt:'🧊' };
  slotsEl.innerHTML = players[0].activeSpells.map((s, i) => {
    return `<button class="swap-slot-btn" onclick="confirmSwap(${i})">
      <span class="swap-slot-icon">${ICON[s]||'✨'}</span>
      <span class="swap-slot-name">${s.toUpperCase()}</span>
    </button>`;
  }).join('');
  modal.style.display = 'flex';
}

function confirmSwap(slotIndex) {
  if (!pendingSwapItem) return;
  if (playerGold < pendingSwapItem.cost) {
    document.getElementById('swapModal').style.display = 'none';
    pendingSwapItem = null;
    return;
  }
  playerGold -= pendingSwapItem.cost;
  players[0].activeSpells[slotIndex] = pendingSwapItem.id;
  pendingSwapItem = null;
  document.getElementById('swapModal').style.display = 'none';
  showShop();
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('swap-cancel').addEventListener('click', () => {
    document.getElementById('swapModal').style.display = 'none';
    pendingSwapItem = null;
  });
});

function closeShop() {
  shopOpen = false;
  document.getElementById('shopPanel').style.display = 'none';
  roundEndPending = false;
  spawnPlayers(); // sets countdownVal=3, gameRunning=false
}

function startGame(e) {
  if (e) e.preventDefault();
  onlineMode = false;
  onlineRole = 'offline';
  onlineRoomId = '';
  guestLastCastNonce = 0;
  localCastNonce = 0;
  resetOnlineRoomRefs();
  while (players.length < 6) {
    const idx = players.length;
    players.push(makePlayer(idx, BOT_NAMES[idx - 1], BOT_COLORS[idx - 1], BOT_GLOWS[idx - 1], true));
  }
  round = 1;
  playerGold = 0;
  shopOpen = false;
  players.forEach(p => {
    p.lives = MAX_LIVES;
    p.activeSpells = ['fireball','thrust'];  // others unlocked in shop
    p.upgrades = {};
    p.spellLevels = {};
    p.gold = 0;
    p.cooldowns = {};
  });
  spawnPlayers(); // sets countdownVal=3, gameRunning=false
  roundEndPending = false;
  hideOverlay();
  document.getElementById('shopPanel').style.display = 'none';
}

// Init
startBtn.addEventListener('touchstart', startGame, { passive: false });
startBtn.addEventListener('click', startGame);
resultStartBtn.addEventListener('touchstart', startGame, { passive: false });
resultStartBtn.addEventListener('click', startGame);
document.getElementById('shopContinueBtn').addEventListener('click', closeShop);
document.getElementById('shopContinueBtn').addEventListener('touchend', (e)=>{ e.preventDefault(); closeShop(); });
// roundRect polyfill for older browsers
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    this.beginPath();
    this.moveTo(x+r,y); this.arcTo(x+w,y,x+w,y+h,r); this.arcTo(x+w,y+h,x,y+h,r);
    this.arcTo(x,y+h,x,y,r); this.arcTo(x,y,x+w,y,r); this.closePath();
  };
}
requestAnimationFrame(loop);
