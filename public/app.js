'use strict';
/* ============ Diario Palestra ============ */

const $ = (s) => document.querySelector(s);
const LS_DATA = 'dp-data', LS_PW = 'dp-pw', LS_MODE = 'dp-mode';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad2 = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateObj = (iso) => new Date(iso + 'T12:00:00');
const fmtDate = (iso) => dateObj(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDateLong = (iso) => dateObj(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (iso) => dateObj(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + pad2(s % 60); };
const fmtNum = (n, d = 1) => n == null ? '–' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: d });
const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

const DEFAULT_EXERCISES = ['Panca piana', 'Panca inclinata', 'Squat', 'Stacco da terra', 'Lat machine', 'Trazioni',
  'Rematore con bilanciere', 'Military press', 'Alzate laterali', 'Curl bicipiti', 'Pushdown tricipiti', 'Dip',
  'Leg press', 'Leg extension', 'Leg curl', 'Affondi', 'Hip thrust', 'Polpacci', 'Crunch', 'Plank', 'Tapis roulant', 'Cyclette'];

const emptyData = () => ({ version: 1, updatedAt: 0, routines: [], workouts: [], weights: [], food: {}, foods: [], meals: [], profile: null, active: null });
function readLocal() { try { const d = JSON.parse(localStorage.getItem(LS_DATA)); return d && d.version ? { ...emptyData(), ...d } : null; } catch { return null; } }

let data = readLocal() || emptyData();
let tab = 'oggi';
const ui = { histEx: '', draft: null };

/* ---------- salvataggio e sincronizzazione ---------- */
let pushTimer = null;
const mode = () => localStorage.getItem(LS_MODE); // 'cloud' | 'local' | null

function writeLocal() { localStorage.setItem(LS_DATA, JSON.stringify(data)); }

// rerender=false per le modifiche nei campi di testo (evita di perdere il focus)
function save(rerender = true) {
  data.updatedAt = Date.now();
  writeLocal();
  if (mode() === 'cloud') { setSync('busy', 'Da salvare'); clearTimeout(pushTimer); pushTimer = setTimeout(push, 1000); }
  if (rerender) render();
}

function setSync(state, msg) { const el = $('#sync'); el.className = 'sync ' + state; el.textContent = msg; }

async function api(method, body) {
  const r = await fetch('/api/data', {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + (localStorage.getItem(LS_PW) || ''), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw Object.assign(new Error('auth'), { auth: true });
  const out = await r.json().catch(() => ({}));
  if (r.status === 409) return out;
  if (!r.ok) throw new Error(out.error || 'HTTP ' + r.status);
  return out;
}

function adoptRemote(remote) {
  data = { ...emptyData(), ...remote };
  writeLocal();
  if (!document.activeElement || !document.activeElement.matches('input, textarea')) render();
}

async function push() {
  if (mode() !== 'cloud') return;
  clearTimeout(pushTimer);
  setSync('busy', 'Salvo…');
  try {
    const res = await api('PUT', data);
    if (res.conflict) { adoptRemote(res.data); toast('Aggiornato con i dati dell\'altro dispositivo'); }
    setSync('ok', 'Sincronizzato');
  } catch (e) {
    if (e.auth) return showLogin('Password non più valida, reinseriscila.');
    setSync('off', 'Offline · salvato qui');
  }
}

async function pull() {
  if (mode() !== 'cloud') { setSync('', mode() === 'local' ? 'Solo questo dispositivo' : ''); return; }
  setSync('busy', 'Sincronizzo…');
  try {
    const remote = await api('GET');
    if (remote && remote.updatedAt > data.updatedAt) { adoptRemote(remote); setSync('ok', 'Sincronizzato'); }
    else if (!remote || remote.updatedAt < data.updatedAt) await push();
    else setSync('ok', 'Sincronizzato');
  } catch (e) {
    if (e.auth) return showLogin('Password errata.');
    setSync('off', 'Offline · salvato qui');
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); else if (pushTimer) push(); });
window.addEventListener('online', pull);

/* ---------- login ---------- */
function showLogin(msg = '') { $('#loginErr').textContent = msg; $('#login').classList.remove('hidden'); setTimeout(() => $('#pw').focus(), 50); }

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pw = $('#pw').value.trim();
  if (!pw) return;
  localStorage.setItem(LS_PW, pw);
  $('#loginErr').textContent = 'Controllo…';
  try {
    await api('GET');
    localStorage.setItem(LS_MODE, 'cloud');
    $('#login').classList.add('hidden');
    $('#pw').value = '';
    await pull();
    toast('Connesso ✓');
  } catch (e) {
    localStorage.removeItem(LS_PW);
    $('#loginErr').textContent = e.auth ? 'Password errata.' : 'Server non raggiungibile: ' + e.message;
  }
});

/* ---------- timer di recupero ---------- */
const timer = { end: 0, total: 0, iv: null };
let actx = null;

function unlockAudio() {
  try {
    // iPhone: fa suonare i bip anche con il telefono in modalità silenziosa
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* nessun audio */ }
}
function startTimer(sec) {
  sec = Number(sec);
  if (!sec || sec <= 0) return;
  unlockAudio();
  timer.total = sec;
  timer.end = Date.now() + sec * 1000;
  clearInterval(timer.iv);
  timer.iv = setInterval(tick, 250);
  tick();
}
function tick() {
  const left = (timer.end - Date.now()) / 1000;
  if (left <= 0) { stopTimer(); alarm(); return; }
  $('#timer').classList.remove('hidden');
  $('#timerTime').textContent = fmtTime(left);
  $('#timerBar').style.width = Math.min(100, 100 * left / timer.total) + '%';
}
function stopTimer() { clearInterval(timer.iv); timer.iv = null; timer.end = 0; $('#timer').classList.add('hidden'); }
// iPhone (iOS 18+): i siti non possono vibrare, ma attivare un interruttore
// "switch" produce un piccolo tocco haptic. Su Android si usa la vibrazione vera.
let hapticLabel = null;
function haptic() {
  if (navigator.vibrate) { navigator.vibrate(200); return; }
  try {
    if (!hapticLabel) {
      const input = document.createElement('input');
      input.type = 'checkbox'; input.id = 'hapticSwitch'; input.setAttribute('switch', '');
      hapticLabel = document.createElement('label');
      hapticLabel.htmlFor = 'hapticSwitch';
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9px;top:0';
      box.append(input, hapticLabel); document.body.append(box);
    }
    hapticLabel.click();
  } catch { /* non supportato */ }
}
function flash() {
  const f = $('#flash'); if (!f) return;
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
}
function alarm() {
  toast('Recupero finito! 💪');
  flash();
  [0, 180, 360, 700, 880, 1060].forEach((ms) => setTimeout(haptic, ms));
  if (!actx) return;
  if (actx.state === 'suspended') actx.resume();
  [0, 0.28, 0.56, 1.1, 1.38, 1.66].forEach((t) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
    const st = actx.currentTime + t;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.5, st + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
    o.start(st); o.stop(st + 0.25);
  });
}

/* ---------- schermo sempre acceso durante l'allenamento ---------- */
let wakeLock = null;
async function syncWakeLock() {
  const want = !!data.active && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  syncWakeLock();
  if (document.visibilityState === 'visible' && timer.iv) tick();
});

/* ---------- utilità sui dati ---------- */
function exerciseNames() {
  const set = new Set(DEFAULT_EXERCISES);
  data.routines.forEach((r) => r.items.forEach((i) => i.name && set.add(i.name)));
  data.workouts.forEach((w) => w.entries.forEach((e) => set.add(e.name)));
  data.active?.entries.forEach((e) => set.add(e.name));
  return [...set].sort((a, b) => a.localeCompare(b, 'it'));
}
const usedExerciseNames = () => {
  const set = new Set();
  data.workouts.forEach((w) => w.entries.forEach((e) => set.add(e.name)));
  return [...set].sort((a, b) => a.localeCompare(b, 'it'));
};
const sortedWorkouts = () => [...data.workouts].sort((a, b) => (b.date + (b.startTime || '')).localeCompare(a.date + (a.startTime || '')));
const sortedWeights = () => [...data.weights].sort((a, b) => a.date.localeCompare(b.date));

function lastEntryFor(name) {
  const key = name.trim().toLowerCase();
  for (const w of sortedWorkouts()) {
    const e = w.entries.find((x) => x.name.trim().toLowerCase() === key);
    if (e) return { w, e };
  }
  return null;
}
const CARDIO_RE = /tapis|tapir|treadmill|cyclette|bike|spinning|ellittic|vogator|rower|corsa|camminat|step|cardio|nuoto|stair|scale|corda|airbike|assault/i;
const isCardioName = (name) => CARDIO_RE.test(name || '');
const isCardio = (e) => e && e.type === 'cardio';
const cardioText = (c) => [c.min != null ? fmtNum(c.min) + ' min' : '', c.km != null ? fmtNum(c.km, 2) + ' km' : '', c.kcal != null ? fmtNum(c.kcal, 0) + ' kcal' : ''].filter(Boolean).join(' · ') || '–';
const setsText = (sets) => sets.map((s) => `${s.reps ?? '?'}${s.kg != null ? '×' + fmtNum(s.kg) + 'kg' : ''}`).join(' · ');
const entryText = (e) => isCardio(e) ? cardioText(e.sets[0] || {}) : setsText(e.sets);
const maxKg = (sets) => { const k = sets.map((s) => s.kg).filter((v) => v != null); return k.length ? Math.max(...k) : null; };

function datalist() { return `<datalist id="exList">${exerciseNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`; }

/* ---------- schede consigliate ---------- */
const POSTURA = [
  { name: 'Gatto-mucca', sets: 2, reps: 10, rest: 30 },
  { name: 'Superman', sets: 3, reps: 10, rest: 30 },
  { name: 'Rotazione busto 90/90', sets: 2, reps: 8, rest: 30 },
];
const TAPIS = { name: 'Tapis roulant', type: 'cardio', min: 15 };
const f = (name, sets, reps, rest) => ({ name, sets, reps, kg: null, rest });
const PRESETS = [
  { name: 'A – Forza (tapis in salita)', items: [...POSTURA, TAPIS,
    f('Chest press', 3, 10, 90), f('Lat machine', 3, 10, 90), TAPIS,
    f('Leg press', 3, 10, 90), f('Crunch', 3, 15, 45), TAPIS] },
  { name: 'B – Resistenza (tapis a intervalli)', items: [...POSTURA, TAPIS,
    f('Leg press', 3, 15, 60), f('Ponte glutei', 3, 15, 45), TAPIS,
    f('Chest press', 3, 15, 60), f('Lat machine', 3, 15, 60), TAPIS] },
  { name: 'C – Mista (tapis a ritmo costante)', items: [...POSTURA, TAPIS,
    f('Lat machine', 3, 12, 75), f('Plank (secondi)', 3, 30, 45), TAPIS,
    f('Leg press', 3, 12, 75), f('Chest press', 3, 12, 75), TAPIS] },
];
const missingPresets = () => data.presetsAdded ? [] : PRESETS.filter((p) => !data.routines.some((r) => r.name === p.name));

/* ---------- grafico SVG ---------- */
function chart(points, unit) {
  if (points.length < 2) return `<p class="muted small">Servono almeno 2 registrazioni per vedere il grafico.</p>`;
  const W = 340, H = 180, P = { l: 40, r: 14, t: 14, b: 26 };
  const xs = points.map((p) => dateObj(p.x).getTime()), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 864e5; x1 += 864e5; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pd = (y1 - y0) * 0.15 || 1; y0 -= pd; y1 += pd;
  const X = (v) => P.l + (v - x0) / (x1 - x0) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const pts = xs.map((x, i) => [X(x), Y(ys[i])]);
  const line = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  const area = `${P.l},${H - P.b} ${line} ${pts[pts.length - 1][0].toFixed(1)},${H - P.b}`;
  const ticks = [0, 0.5, 1].map((f) => y0 + (y1 - y0) * f);
  const last = pts[pts.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafico ${esc(unit)}">
    ${ticks.map((t) => `<line class="grid-l" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${P.l - 6}" y="${Y(t) + 3}" text-anchor="end">${fmtNum(t)}</text>`).join('')}
    <polygon class="area" points="${area}"/>
    <polyline class="line" points="${line}"/>
    ${points.length <= 40 ? pts.slice(0, -1).map((p) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3"/>`).join('') : ''}
    <circle class="last" cx="${last[0]}" cy="${last[1]}" r="5"/>
    <text class="axis" x="${P.l}" y="${H - 8}">${fmtShort(points[0].x)}</text>
    <text class="axis" x="${W - P.r}" y="${H - 8}" text-anchor="end">${fmtShort(points[points.length - 1].x)}</text>
  </svg>`;
}

/* ---------- viste ---------- */
function quickTimer() {
  return `<section class="card"><p class="label">Timer rapido</p><div class="chips">
    ${[45, 60, 90, 120, 180].map((s) => `<button class="chip" data-action="timer" data-s="${s}">${s < 60 ? s + 's' : fmtTime(s)}</button>`).join('')}
  </div></section>`;
}

function viewOggi() {
  const a = data.active;
  if (!a) {
    const last = sortedWorkouts()[0];
    return `<section class="card">
      <div><h2>Nuovo allenamento</h2><p class="muted">${fmtDateLong(today())}</p></div>
      ${data.routines.length
        ? `<p class="label">Parti da una scheda</p><div class="grid">${data.routines.map((r) =>
          `<button class="btn big" data-action="startRoutine" data-id="${r.id}">${esc(r.name)}<small>${r.items.length} esercizi</small></button>`).join('')}</div>`
        : `<p class="muted">Non hai ancora schede: creale nella sezione <b>Schede</b>, oppure inizia un allenamento libero.</p>`}
      <button class="btn primary wide" data-action="startFree">+ Allenamento libero</button>
    </section>
    ${quickTimer()}
    ${last ? `<section class="card"><p class="label">Ultimo allenamento</p>
      <div class="row between"><b>${esc(last.name)}</b><span class="muted small">${fmtDate(last.date)}</span></div>
      <p class="muted small">${last.entries.map((e) => esc(e.name)).join(', ')}</p></section>` : ''}`;
  }
  return `<section class="card">
      <div class="row between"><div><h2>${esc(a.name)}</h2><p class="muted small">${fmtDate(a.date)} · iniziato alle ${a.startTime}</p></div>
      <button class="btn ghost small danger" data-action="cancelWorkout">Annulla</button></div>
    </section>
    ${quickTimer()}
    ${a.entries.map(entryCard).join('')}
    <section class="card"><p class="label">Aggiungi esercizio</p>
      <div class="row"><input list="exList" id="newEx" placeholder="Es. Panca piana" enterkeyhint="done"><button class="btn" data-action="addEntry">Aggiungi</button></div>
    </section>
    <label class="card block"><span class="label">Note</span><textarea data-field="notes" rows="2" placeholder="Come ti sei sentito, dolori, ecc.">${esc(a.notes || '')}</textarea></label>
    <button class="btn primary wide" data-action="finishWorkout">✓ Termina e salva allenamento</button>
    ${datalist()}`;
}

function typeSwitch(cardio, attrs) {
  return `<div class="seg" role="group" aria-label="Tipo di esercizio">
    <button class="${cardio ? '' : 'on'}" ${attrs} data-type="forza">Forza</button><button class="${cardio ? 'on' : ''}" ${attrs} data-type="cardio">Cardio</button></div>`;
}

function cardioCard(e, i) {
  const c = e.sets[0] || (e.sets[0] = { min: null, km: null, kcal: null, done: false });
  const prev = lastEntryFor(e.name);
  const v = (x) => x != null ? String(x).replace('.', ',') : '';
  return `<section class="card">
    <div class="row between"><h3>${esc(e.name)}</h3><button class="icon" data-action="removeEntry" data-i="${i}" aria-label="Rimuovi esercizio">✕</button></div>
    ${typeSwitch(true, `data-action="setEntryType" data-i="${i}"`)}
    ${prev && isCardio(prev.e) ? `<p class="muted small">Ultima volta (${fmtShort(prev.w.date)}): ${entryText(prev.e)}</p>` : ''}
    <div class="cardio ${c.done ? 'done' : ''}">
      <label>Minuti<input inputmode="decimal" data-set="${i}.0.min" value="${v(c.min)}" placeholder="–"></label>
      <label>Km<input inputmode="decimal" data-set="${i}.0.km" value="${v(c.km)}" placeholder="–"></label>
      <label>Kcal<input inputmode="numeric" data-set="${i}.0.kcal" value="${v(c.kcal)}" placeholder="–"></label>
      <button class="check" data-action="toggleSet" data-i="${i}" data-j="0" aria-label="Fatto">${c.done ? '✓' : ''}</button>
    </div>
  </section>`;
}

function entryCard(e, i) {
  if (isCardio(e)) return cardioCard(e, i);
  const prev = lastEntryFor(e.name);
  return `<section class="card">
    <div class="row between"><h3>${esc(e.name)}</h3><button class="icon" data-action="removeEntry" data-i="${i}" aria-label="Rimuovi esercizio">✕</button></div>
    ${typeSwitch(false, `data-action="setEntryType" data-i="${i}"`)}
    ${prev && !isCardio(prev.e) ? `<p class="muted small">Ultima volta (${fmtShort(prev.w.date)}): ${setsText(prev.e.sets)}</p>` : ''}
    <div class="sets">
      <div class="set head"><span>#</span><span>Ripetiz.</span><span>Kg</span><span></span></div>
      ${e.sets.map((s, j) => `<div class="set ${s.done ? 'done' : ''}">
        <span>${j + 1}</span>
        <input inputmode="numeric" data-set="${i}.${j}.reps" value="${s.reps ?? ''}" placeholder="–" aria-label="Ripetizioni serie ${j + 1}">
        <input inputmode="decimal" data-set="${i}.${j}.kg" value="${s.kg != null ? String(s.kg).replace('.', ',') : ''}" placeholder="–" aria-label="Kg serie ${j + 1}">
        <button class="check" data-action="toggleSet" data-i="${i}" data-j="${j}" aria-label="Serie fatta">${s.done ? '✓' : ''}</button>
      </div>`).join('')}
    </div>
    <div class="row between">
      <div class="row"><button class="btn small" data-action="addSet" data-i="${i}">+ Serie</button>
      ${e.sets.length > 1 ? `<button class="btn small ghost" data-action="removeSet" data-i="${i}">− Serie</button>` : ''}</div>
      <label class="rest">Recupero <input inputmode="numeric" data-rest="${i}" value="${e.rest ?? ''}" placeholder="90"> s</label>
    </div>
  </section>`;
}

function viewStorico() {
  const ws = sortedWorkouts();
  if (!ws.length) return `<section class="card"><h2>Storico</h2><p class="muted">Qui troverai i tuoi allenamenti una volta salvati.</p></section>`;
  const monthKey = today().slice(0, 7);
  const thisMonth = ws.filter((w) => w.date.startsWith(monthKey)).length;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const thisWeek = ws.filter((w) => w.date >= weekAgo).length;

  const names = usedExerciseNames();
  if (!ui.histEx || !names.includes(ui.histEx)) ui.histEx = names[0] || '';
  const exEntries = ws.slice().reverse().map((w) => ({ w, e: w.entries.find((x) => x.name === ui.histEx) })).filter((x) => x.e);
  const cardioEx = exEntries.length > 0 && isCardio(exEntries[exEntries.length - 1].e);
  const cardioField = cardioEx && exEntries.filter((x) => x.e.sets[0]?.km != null).length >= 2 ? 'km' : 'min';
  const unit = cardioEx ? (cardioField === 'km' ? 'km' : 'min') : 'kg';
  const pts = exEntries.map(({ w, e }) => {
    const sameName = w.entries.filter((x) => x.name === ui.histEx && isCardio(x));
    const vals = sameName.map((x) => x.sets[0]?.[cardioField]).filter((v) => v != null);
    const k = cardioEx ? (vals.length ? vals.reduce((a, b) => a + b, 0) : null) : (isCardio(e) ? null : maxKg(e.sets));
    return k != null ? { x: w.date, y: k } : null;
  }).filter(Boolean);
  const best = pts.length ? Math.max(...pts.map((p) => p.y)) : null;
  const monthCardio = ws.filter((w) => w.date.startsWith(monthKey)).flatMap((w) => w.entries.filter(isCardio)).reduce((t, e) => t + (e.sets[0]?.min || 0), 0);

  return `<section class="card"><h2>I tuoi numeri</h2>
      <div class="stats">
        <div class="stat"><b>${thisWeek}</b><span>ultimi 7 giorni</span></div>
        <div class="stat"><b>${thisMonth}</b><span>questo mese</span></div>
        <div class="stat"><b>${ws.length}</b><span>totali</span></div>
      </div>
      ${monthCardio ? `<p class="muted small">🏃 Cardio questo mese: <b>${fmtNum(monthCardio, 0)} minuti</b></p>` : ''}</section>
    <section class="card"><p class="label">Progressi per esercizio</p>
      ${names.length ? `<select data-action-change="histEx">${names.map((n) => `<option ${n === ui.histEx ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <p class="muted small">${cardioEx ? (unit === 'km' ? 'Distanza (km) per sessione' : 'Durata (minuti) per sessione') : 'Carico massimo (kg) per sessione'}
      ${best != null ? ` · Record: <b class="pos">${fmtNum(best, 2)} ${unit}</b>` : ''}</p>
      ${chart(pts, unit)}` : ''}
    </section>
    <section class="card"><p class="label">Allenamenti</p><div class="list">
      ${ws.map((w) => `<details class="workout li">
        <summary><div><b>${esc(w.name)}</b><div class="muted small">${fmtDate(w.date)}${w.duration ? ' · ' + w.duration + ' min' : ''} · ${w.entries.length} esercizi</div></div></summary>
        <div class="detail">
          ${w.entries.map((e) => `<div class="ex-line"><b>${esc(e.name)}</b><span>${isCardio(e) ? '🏃 ' : ''}${entryText(e)}</span></div>`).join('')}
          ${w.notes ? `<p class="muted small">📝 ${esc(w.notes)}</p>` : ''}
          <div class="row"><button class="btn small" data-action="repeatWorkout" data-id="${w.id}">Ripeti</button>
          <button class="btn small ghost danger" data-action="deleteWorkout" data-id="${w.id}">Elimina</button></div>
        </div>
      </details>`).join('')}
    </div></section>`;
}

function viewPeso() {
  const ws = sortedWeights();
  const first = ws[0], last = ws[ws.length - 1];
  const diff = first && last ? last.kg - first.kg : null;
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const ref30 = ws.filter((w) => w.date <= monthAgo).pop() || first;
  const diff30 = ref30 && last && ref30 !== last ? last.kg - ref30.kg : null;
  const cls = (d) => d == null ? '' : d < 0 ? 'pos' : d > 0 ? 'neg' : '';
  const sign = (d) => d == null ? '–' : (d > 0 ? '+' : '') + fmtNum(d);

  return `<section class="card"><h2>Peso corporeo</h2>
      <div class="row"><input type="date" id="wDate" value="${today()}" max="${today()}" style="flex:1.2">
      <input inputmode="decimal" id="wKg" placeholder="Kg" style="flex:1" enterkeyhint="done"><button class="btn primary" data-action="addWeight">Salva</button></div>
    </section>
    ${ws.length ? `<section class="card">
      <div class="stats">
        <div class="stat"><b>${fmtNum(last.kg)}</b><span>attuale (kg)</span></div>
        <div class="stat"><b class="${cls(diff)}">${sign(diff)}</b><span>dall'inizio</span></div>
        <div class="stat"><b class="${cls(diff30)}">${sign(diff30)}</b><span>ultimi 30 gg</span></div>
      </div>
      ${diff != null && diff < 0 ? `<p class="muted small">Hai perso <b class="pos">${fmtNum(-diff)} kg</b> dal ${fmtShort(first.date)} 🎉</p>` : ''}
      ${chart(ws.map((w) => ({ x: w.date, y: w.kg })), 'kg')}
    </section>
    <section class="card"><p class="label">Registrazioni</p><div class="list">
      ${ws.slice().reverse().map((w, i, arr) => {
        const prev = arr[i + 1]; const d = prev ? w.kg - prev.kg : null;
        return `<div class="li"><span>${fmtDate(w.date)}</span><span><b>${fmtNum(w.kg)} kg</b> <small class="${cls(d)}">${d != null ? sign(d) : ''}</small>
        <button class="icon" data-action="deleteWeight" data-id="${w.id}" aria-label="Elimina">✕</button></span></div>`;
      }).join('')}
    </div></section>` : `<section class="card"><p class="muted">Pesati ogni tanto (meglio la mattina, a digiuno) e qui vedrai l'andamento.</p></section>`}`;
}

function viewSchede() {
  const d = ui.draft;
  if (d) {
    return `<section class="card">
        <h2>${data.routines.some((r) => r.id === d.id) ? 'Modifica scheda' : 'Nuova scheda'}</h2>
        <input data-draft="name" value="${esc(d.name)}" placeholder="Nome (es. Giorno A – Petto e tricipiti)">
      </section>
      ${d.items.map((it, i) => `<div class="item">
        <div class="name"><input list="exList" data-item="${i}.name" value="${esc(it.name)}" placeholder="Esercizio"><button class="icon" data-action="removeItem" data-i="${i}" aria-label="Rimuovi">✕</button></div>
        <div class="full">${typeSwitch(it.type === 'cardio', `data-action="setItemType" data-i="${i}"`)}</div>
        ${it.type === 'cardio' ? `
        <label class="half">Minuti<input inputmode="decimal" data-item="${i}.min" value="${it.min ?? ''}" placeholder="auto"></label>
        <label class="half">Km<input inputmode="decimal" data-item="${i}.km" value="${it.km ?? ''}" placeholder="auto"></label>` : `
        <label>Serie<input inputmode="numeric" data-item="${i}.sets" value="${it.sets ?? ''}"></label>
        <label>Ripetiz.<input inputmode="numeric" data-item="${i}.reps" value="${it.reps ?? ''}"></label>
        <label>Kg<input inputmode="decimal" data-item="${i}.kg" value="${it.kg ?? ''}" placeholder="auto"></label>
        <label>Recup. s<input inputmode="numeric" data-item="${i}.rest" value="${it.rest ?? ''}"></label>`}
      </div>`).join('')}
      <button class="btn wide" data-action="addItem">+ Aggiungi esercizio</button>
      <div class="row"><button class="btn ghost wide" data-action="cancelDraft">Annulla</button><button class="btn primary wide" data-action="saveDraft">Salva scheda</button></div>
      <p class="muted small">Se lasci vuoti Kg, minuti o km, all'avvio verranno proposti quelli dell'ultima volta. Tapis roulant, cyclette, ellittica e simili vengono impostati come cardio in automatico.</p>
      ${datalist()}`;
  }
  const miss = missingPresets();
  return `${miss.length ? `<section class="card preset">
      <p class="label">Schede consigliate per te</p>
      <p class="muted small">3 schede da alternare (A → B → C): posturali, poi 15' di tapis roulant, 2 esercizi, 15' di tapis, 2 esercizi, 15' di tapis. Puoi modificarle quando vuoi.</p>
      <div class="list">${miss.map((p) => `<div class="li"><b>${esc(p.name)}</b></div>`).join('')}</div>
      <button class="btn primary wide" data-action="addPresets">Aggiungi ${miss.length === 1 ? 'la scheda' : 'le ' + miss.length + ' schede'}</button>
    </section>` : ''}
    <section class="card"><div class="row between"><h2>Le tue schede</h2><button class="btn primary small" data-action="newRoutine">+ Nuova</button></div>
      ${data.routines.length ? `<div class="list">${data.routines.map((r) => `<div class="li">
        <div><b>${esc(r.name)}</b><div class="muted small">${r.items.map((i) => esc(i.name)).join(', ') || 'vuota'}</div></div>
        <div class="row"><button class="btn small" data-action="editRoutine" data-id="${r.id}">Modifica</button>
        <button class="icon" data-action="deleteRoutine" data-id="${r.id}" aria-label="Elimina">✕</button></div></div>`).join('')}</div>`
        : '<p class="muted">Crea le tue routine (es. Giorno A, Giorno B) con serie, ripetizioni e tempi di recupero: poi le avvii con un tocco.</p>'}
    </section>
    <section class="card"><p class="label">Impostazioni e backup</p>
      <p class="muted small">${mode() === 'cloud' ? '☁️ Sincronizzazione attiva tra i tuoi dispositivi.' : '📱 Dati salvati solo su questo dispositivo.'}</p>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn small" data-action="exportData">Esporta backup</button>
        <button class="btn small" data-action="importData">Importa backup</button>
        ${mode() === 'cloud' ? '<button class="btn small" data-action="syncNow">Sincronizza ora</button>' : ''}
        <button class="btn small ghost" data-action="logout">${mode() === 'cloud' ? 'Esci' : 'Attiva sincronizzazione'}</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </section>`;
}

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const views = { oggi: viewOggi, cibo: viewCibo, storico: viewStorico, peso: viewPeso, schede: viewSchede };
  $('#view').innerHTML = views[tab]();
  syncWakeLock();
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

/* ---------- azioni ---------- */
function newWorkout(name, entries, routineId = null) {
  data.active = { id: uid(), date: today(), startTime: nowTime(), startedAt: Date.now(), name, routineId, entries, notes: '' };
}
function cardioFromLast(name, min, km) {
  const prev = lastEntryFor(name);
  const pc = prev && isCardio(prev.e) ? prev.e.sets[0] || {} : {};
  return [{ min: min ?? pc.min ?? null, km: km ?? pc.km ?? null, kcal: null, done: false }];
}
function makeEntry(name, opts = {}) {
  const prev = lastEntryFor(name);
  const cardio = opts.type ? opts.type === 'cardio' : prev ? isCardio(prev.e) : isCardioName(name);
  if (cardio) return { name, type: 'cardio', sets: cardioFromLast(name, opts.min ?? null, opts.km ?? null) };
  const n = opts.sets || (prev && !isCardio(prev.e) ? prev.e.sets.length : 3);
  return { name, rest: opts.rest ?? (prev && !isCardio(prev.e) ? prev.e.rest : null) ?? 90, sets: setsFromLast(name, n, opts.reps ?? null, opts.kg ?? null) };
}
function setsFromLast(name, n, reps, kg) {
  const prev = lastEntryFor(name);
  return Array.from({ length: n }, (_, j) => {
    const ps = prev && !isCardio(prev.e) ? prev.e.sets[j] || prev.e.sets[prev.e.sets.length - 1] : null;
    return { reps: reps ?? ps?.reps ?? null, kg: kg ?? ps?.kg ?? null, done: false };
  });
}

const actions = {
  timer: (b) => startTimer(b.dataset.s),
  timerAdd: (b) => {
    const s = Number(b.dataset.s);
    if (!timer.iv) { if (s > 0) startTimer(s); return; }
    timer.end += s * 1000; timer.total = Math.max(timer.total + s, 1); tick();
  },
  timerStop: stopTimer,

  startFree: () => { newWorkout('Allenamento libero', []); save(); setTimeout(() => $('#newEx')?.focus(), 50); },
  startRoutine: (b) => {
    const r = data.routines.find((x) => x.id === b.dataset.id); if (!r) return;
    newWorkout(r.name, r.items.map((it) => makeEntry(it.name, { type: it.type || (isCardioName(it.name) ? 'cardio' : 'forza'), sets: it.sets || 3, reps: it.reps ?? null, kg: it.kg ?? null, rest: it.rest ?? 90, min: it.min ?? null, km: it.km ?? null })), r.id);
    save();
  },
  repeatWorkout: (b) => {
    if (data.active && !confirm('Hai già un allenamento in corso. Sostituirlo?')) return;
    const w = data.workouts.find((x) => x.id === b.dataset.id); if (!w) return;
    newWorkout(w.name, w.entries.map((e) => isCardio(e)
      ? { name: e.name, type: 'cardio', sets: [{ ...(e.sets[0] || {}), done: false }] }
      : { name: e.name, rest: e.rest ?? 90, sets: e.sets.map((s) => ({ reps: s.reps, kg: s.kg, done: false })) }), w.routineId);
    tab = 'oggi'; save(); window.scrollTo(0, 0);
  },
  addEntry: () => {
    const name = $('#newEx').value.trim(); if (!name) return $('#newEx').focus();
    data.active.entries.push(makeEntry(name));
    save();
  },
  removeEntry: (b) => { if (confirm('Rimuovere questo esercizio?')) { data.active.entries.splice(+b.dataset.i, 1); save(); } },
  addSet: (b) => { const e = data.active.entries[+b.dataset.i]; const l = e.sets[e.sets.length - 1]; e.sets.push({ reps: l?.reps ?? null, kg: l?.kg ?? null, done: false }); save(); },
  removeSet: (b) => { data.active.entries[+b.dataset.i].sets.pop(); save(); },
  toggleSet: (b) => {
    const e = data.active.entries[+b.dataset.i]; const s = e.sets[+b.dataset.j];
    s.done = !s.done;
    if (s.done && !isCardio(e)) startTimer(e.rest || 90);
    save();
  },
  setEntryType: (b) => {
    const i = +b.dataset.i, e = data.active.entries[i];
    if ((b.dataset.type === 'cardio') === isCardio(e)) return;
    data.active.entries[i] = makeEntry(e.name, { type: b.dataset.type });
    save();
  },
  setItemType: (b) => {
    const it = ui.draft.items[+b.dataset.i];
    it.type = b.dataset.type; it.typeManual = true; render();
  },
  cancelWorkout: () => { if (confirm('Annullare l\'allenamento in corso? Non verrà salvato.')) { data.active = null; stopTimer(); save(); } },
  finishWorkout: () => {
    const a = data.active;
    const entries = a.entries.map((e) => isCardio(e)
      ? { name: e.name, type: 'cardio', sets: e.sets.filter((s) => s.done).map(({ min, km, kcal }) => ({ min, km, kcal })) }
      : { name: e.name, rest: e.rest, sets: e.sets.filter((s) => s.done).map(({ reps, kg }) => ({ reps, kg })) })
      .filter((e) => e.sets.length);
    if (!entries.length) { alert('Spunta ✓ almeno una serie o un cardio completato prima di salvare.'); return; }
    const skipped = a.entries.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    if (skipped && !confirm(`${skipped} serie/cardio non spuntati non verranno salvati. Continuare?`)) return;
    data.workouts.push({ id: a.id, date: a.date, startTime: a.startTime, name: a.name, routineId: a.routineId, entries, notes: a.notes || '',
      duration: Math.max(1, Math.round((Date.now() - a.startedAt) / 60000)) });
    data.active = null; stopTimer(); save(); toast('Allenamento salvato 💪');
  },
  deleteWorkout: (b) => { if (confirm('Eliminare questo allenamento?')) { data.workouts = data.workouts.filter((w) => w.id !== b.dataset.id); save(); } },

  addWeight: () => {
    const kg = num($('#wKg').value), date = $('#wDate').value || today();
    if (kg == null || kg < 20 || kg > 400) { toast('Inserisci un peso valido'); return $('#wKg').focus(); }
    data.weights = data.weights.filter((w) => w.date !== date);
    data.weights.push({ id: uid(), date, kg });
    save(); toast('Peso salvato');
  },
  deleteWeight: (b) => { if (confirm('Eliminare questa registrazione?')) { data.weights = data.weights.filter((w) => w.id !== b.dataset.id); save(); } },

  addPresets: () => {
    missingPresets().forEach((p) => data.routines.push({ id: uid(), name: p.name, items: p.items.map((i) => ({ ...i })) }));
    data.presetsAdded = true;
    save(); toast('Schede aggiunte 💪');
  },
  newRoutine: () => { ui.draft = { id: uid(), name: '', items: [{ name: '', sets: 3, reps: 10, kg: null, rest: 90 }] }; render(); },
  editRoutine: (b) => { const r = data.routines.find((x) => x.id === b.dataset.id); ui.draft = JSON.parse(JSON.stringify(r)); render(); },
  deleteRoutine: (b) => { if (confirm('Eliminare questa scheda?')) { data.routines = data.routines.filter((r) => r.id !== b.dataset.id); save(); } },
  addItem: () => { const l = ui.draft.items[ui.draft.items.length - 1]; ui.draft.items.push({ name: '', sets: l?.sets ?? 3, reps: l?.reps ?? 10, kg: null, rest: l?.rest ?? 90 }); render(); },
  removeItem: (b) => { ui.draft.items.splice(+b.dataset.i, 1); render(); },
  cancelDraft: () => { ui.draft = null; render(); },
  saveDraft: () => {
    const d = ui.draft;
    d.name = d.name.trim(); d.items = d.items.filter((i) => i.name.trim()).map((i) => ({ ...i, name: i.name.trim() }));
    if (!d.name) { toast('Dai un nome alla scheda'); return; }
    if (!d.items.length) { toast('Aggiungi almeno un esercizio'); return; }
    const i = data.routines.findIndex((r) => r.id === d.id);
    if (i >= 0) data.routines[i] = d; else data.routines.push(d);
    ui.draft = null; save(); toast('Scheda salvata');
  },

  exportData: () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `diario-palestra-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importData: () => $('#importFile').click(),
  syncNow: () => pull(),
  logout: () => {
    if (mode() === 'cloud' && !confirm('Uscire? I dati restano salvati su Cloudflare.')) return;
    localStorage.removeItem(LS_PW); localStorage.removeItem(LS_MODE); setSync('', ''); showLogin();
  },
  localMode: () => { localStorage.setItem(LS_MODE, 'local'); $('#login').classList.add('hidden'); setSync('', 'Solo questo dispositivo'); render(); },
};

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; ui.draft = null; render(); window.scrollTo(0, 0); return; }
  const b = ev.target.closest('[data-action]');
  if (b && actions[b.dataset.action]) actions[b.dataset.action](b, ev);
});

// Modifiche nei campi: salvo senza ridisegnare, così non si perde il focus
document.addEventListener('input', (ev) => {
  const el = ev.target, ds = el.dataset;
  if (ds.set) {
    const [i, j, f] = ds.set.split('.');
    data.active.entries[+i].sets[+j][f] = num(el.value); save(false);
  } else if (ds.rest) {
    data.active.entries[+ds.rest].rest = num(el.value); save(false);
  } else if (ds.field === 'notes') {
    data.active.notes = el.value; save(false);
  } else if (ds.draft) {
    ui.draft[ds.draft] = el.value;
  } else if (ds.item) {
    const [i, f] = ds.item.split('.');
    ui.draft.items[+i][f] = f === 'name' ? el.value : num(el.value);
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.actionChange === 'histEx') { ui.histEx = el.value; render(); }
  if (el.dataset.item && el.dataset.item.endsWith('.name') && ui.draft) {
    const it = ui.draft.items[+el.dataset.item.split('.')[0]];
    const t = isCardioName(it.name) ? 'cardio' : 'forza';
    if (!it.typeManual && (it.type || 'forza') !== t) { it.type = t; render(); }
  }
  if (el.id === 'importFile' && el.files[0]) {
    el.files[0].text().then((txt) => {
      const d = JSON.parse(txt);
      if (!d.version || !Array.isArray(d.workouts)) throw new Error('formato');
      if (!confirm('Sostituire tutti i dati attuali con quelli del backup?')) return;
      data = { ...emptyData(), ...d }; save(); toast('Backup importato');
    }).catch(() => alert('File di backup non valido.'));
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'newEx') actions.addEntry();
  if (ev.target.id === 'wKg') actions.addWeight();
});

document.addEventListener('pointerdown', unlockAudio, { once: true });

/* ============ CIBO E CALORIE ============ */
const MEALS = [
  { id: 'colazione', label: 'Colazione', icon: '☕' },
  { id: 'pranzo', label: 'Pranzo', icon: '🍝' },
  { id: 'cena', label: 'Cena', icon: '🍽️' },
  { id: 'spuntini', label: 'Spuntini', icon: '🍎' },
];
const ACTIVITY = [
  { v: 1.2, label: 'Sedentario (lavoro seduto, poco movimento)' },
  { v: 1.375, label: 'Leggero (palestra 1-3 volte a settimana)' },
  { v: 1.55, label: 'Moderato (palestra 3-5 volte a settimana)' },
  { v: 1.725, label: 'Intenso (sport quasi tutti i giorni)' },
];
const foodState = { sheet: null, profDraft: null, editProfile: false };
const GENERIC = (window.GENERIC_FOODS || []).map(([name, kcal, p, c, f, serving, label], i) =>
  ({ id: 'g' + i, name, brand: '', generic: true, per100: { kcal, p, c, f }, serving: serving || null, servingLabel: label || '' }));
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ');
function localSearch(q) {
  const words = fold(q).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return GENERIC.map((g) => {
    const n = fold(g.name);
    if (!words.every((w) => n.includes(w))) return null;
    const score = (n.startsWith(words[0]) ? 0 : n.includes(' ' + words[0]) ? 1 : 2) * 100 + n.length;
    return { g, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 15).map((x) => x.g);
}
if (!ui.foodDate) ui.foodDate = today();

const shiftDate = (iso, d) => { const x = dateObj(iso); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
const dayFood = (iso) => (data.food && data.food[iso]) || [];
const nut = (it) => { const k = (it.g || 0) / 100, p = it.per100 || {}; return { kcal: (p.kcal || 0) * k, p: (p.p || 0) * k, c: (p.c || 0) * k, f: (p.f || 0) * k }; };
const sumNut = (items) => items.reduce((t, it) => { const n = nut(it); t.kcal += n.kcal; t.p += n.p; t.c += n.c; t.f += n.f; return t; }, { kcal: 0, p: 0, c: 0, f: 0 });
const latestWeight = () => { const w = sortedWeights(); return w.length ? w[w.length - 1].kg : null; };

function targets() {
  const pr = data.profile; if (!pr) return null;
  const w = latestWeight() ?? pr.weight; if (!w || !pr.height || !pr.age) return null;
  const male = pr.sex !== 'f';
  const bmr = 10 * w + 6.25 * pr.height - 5 * pr.age + (male ? 5 : -161);
  const tdee = bmr * (pr.activity || 1.375);
  const lose = pr.goal !== 'mantenere';
  const kcal = Math.round(lose ? Math.max(tdee - 400, male ? 1500 : 1200) : tdee);
  const p = Math.round(w * (lose ? 1.6 : 1.4));
  const f = Math.round(kcal * 0.28 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, c, f, tdee: Math.round(tdee), w };
}

function cardioKcal(iso) {
  const entries = data.workouts.filter((w) => w.date === iso).flatMap((w) => w.entries);
  if (data.active && data.active.date === iso) entries.push(...data.active.entries.filter((e) => e.sets[0]?.done));
  return entries.filter(isCardio).reduce((t, e) => t + (e.sets[0]?.kcal || 0), 0);
}

function bar(value, target, cls = '') {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return `<div class="bar ${cls} ${target && value > target ? 'over' : ''}"><i style="width:${pct}%"></i></div>`;
}

function viewProfile() {
  const pr = foodState.profDraft || (foodState.profDraft = { sex: 'm', age: '', height: '', weight: latestWeight() ?? '', activity: 1.375, goal: 'dimagrire', ...(data.profile || {}) });
  if (latestWeight() != null && !foodState.profDraft._wTouched) pr.weight = latestWeight();
  return `<section class="card">
    <h2>${data.profile ? 'I tuoi dati' : 'Calcoliamo il tuo obiettivo'}</h2>
    <p class="muted small">Servono per stimare quante calorie ti servono al giorno (formula di Mifflin-St Jeor). Restano solo nel tuo diario.</p>
    <div class="form2">
      <label>Sesso<select data-prof="sex"><option value="m" ${pr.sex !== 'f' ? 'selected' : ''}>Uomo</option><option value="f" ${pr.sex === 'f' ? 'selected' : ''}>Donna</option></select></label>
      <label>Età<input inputmode="numeric" data-prof="age" value="${pr.age ?? ''}" placeholder="anni"></label>
      <label>Altezza<input inputmode="numeric" data-prof="height" value="${pr.height ?? ''}" placeholder="cm"></label>
      <label>Peso attuale<input inputmode="decimal" data-prof="weight" value="${pr.weight != null ? String(pr.weight).replace('.', ',') : ''}" placeholder="kg"></label>
    </div>
    <label class="block-l">Attività<select data-prof="activity">${ACTIVITY.map((a) => `<option value="${a.v}" ${Number(pr.activity) === a.v ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label>
    <label class="block-l">Obiettivo<select data-prof="goal">
      <option value="dimagrire" ${pr.goal !== 'mantenere' ? 'selected' : ''}>Dimagrire gradualmente (circa −0,4 kg a settimana)</option>
      <option value="mantenere" ${pr.goal === 'mantenere' ? 'selected' : ''}>Mantenere il peso</option></select></label>
    <div class="row">${data.profile ? '<button class="btn ghost wide" data-action="cancelProfile">Annulla</button>' : ''}<button class="btn primary wide" data-action="saveProfile">Calcola e salva</button></div>
  </section>`;
}

function viewCibo() {
  if (!data.profile || foodState.editProfile) return viewProfile();
  const d = ui.foodDate, items = dayFood(d), tot = sumNut(items), t = targets();
  const burned = cardioKcal(d);
  const left = t ? t.kcal - tot.kcal : null;
  const isToday = d === today();
  return `<section class="card day-nav">
      <button class="icon big" data-action="foodDay" data-d="-1" aria-label="Giorno precedente">‹</button>
      <b>${isToday ? 'Oggi' : d === shiftDate(today(), -1) ? 'Ieri' : fmtDate(d)}</b>
      <button class="icon big" data-action="foodDay" data-d="1" ${isToday ? 'disabled' : ''} aria-label="Giorno successivo">›</button>
    </section>
    <section class="card">
      <div class="kcal-head"><div><b class="kcal-big">${fmtNum(tot.kcal, 0)}</b><span class="muted"> / ${t ? fmtNum(t.kcal, 0) : '–'} kcal</span></div>
        ${left != null ? `<span class="${left >= 0 ? 'pos' : 'neg'}">${left >= 0 ? 'Restano ' + fmtNum(left, 0) : 'Oltre di ' + fmtNum(-left, 0)}</span>` : ''}</div>
      ${bar(tot.kcal, t?.kcal)}
      <div class="macros">
        <div><span>Proteine</span><b>${fmtNum(tot.p, 0)}<small>/${t ? t.p : '–'} g</small></b>${bar(tot.p, t?.p, 'p')}</div>
        <div><span>Carboidrati</span><b>${fmtNum(tot.c, 0)}<small>/${t ? t.c : '–'} g</small></b>${bar(tot.c, t?.c, 'c')}</div>
        <div><span>Grassi</span><b>${fmtNum(tot.f, 0)}<small>/${t ? t.f : '–'} g</small></b>${bar(tot.f, t?.f, 'f')}</div>
      </div>
      ${burned ? `<p class="muted small">🏃 Cardio di oggi: −${fmtNum(burned, 0)} kcal (già considerato nel tuo livello di attività)</p>` : ''}
    </section>
    ${MEALS.map((m) => {
      const its = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.meal === m.id);
      const mt = sumNut(its.map((x) => x.it));
      return `<section class="card meal">
        <div class="row between"><h3>${m.icon} ${m.label}</h3><span class="muted">${its.length ? fmtNum(mt.kcal, 0) + ' kcal' : ''}</span></div>
        ${its.length ? `<div class="list">${its.map(({ it, idx }) => `<div class="li food-li">
          <button class="food-name" data-action="editFood" data-idx="${idx}"><b>${esc(it.name)}</b><small>${it.brand ? esc(it.brand) + ' · ' : ''}${fmtNum(it.g, 0)} g · ${fmtNum(nut(it).kcal, 0)} kcal</small></button>
          <button class="icon" data-action="delFood" data-idx="${idx}" aria-label="Elimina">✕</button></div>`).join('')}</div>` : ''}
        <div class="row"><button class="btn small" data-action="openFoodSheet" data-meal="${m.id}">+ Aggiungi</button>
        ${its.length > 1 ? `<button class="btn small ghost" data-action="saveMeal" data-meal="${m.id}">☆ Salva come pasto</button>` : ''}</div>
      </section>`;
    }).join('')}
    <section class="card"><div class="row between"><div><p class="label">Il tuo obiettivo</p>
      <p class="muted small">${t ? `${fmtNum(t.kcal, 0)} kcal al giorno (fabbisogno stimato ${fmtNum(t.tdee, 0)}) · peso ${fmtNum(t.w)} kg` : 'Completa i tuoi dati'}</p></div>
      <button class="btn small" data-action="editProfile">Modifica</button></div>
      <p class="muted small">Sono stime: se in 2-3 settimane il peso non scende come previsto, si aggiusta l'obiettivo.</p>
    </section>`;
}

/* --- pannello aggiungi alimento --- */
function openSheet(meal) {
  foodState.sheet = { meal, tab: 'cerca', query: '', results: null, loading: false, err: '', pick: null, grams: null };
  renderSheet();
  $('#sheet').classList.remove('hidden');
  setTimeout(() => $('#foodQ')?.focus(), 80);
}
function closeSheet() { foodState.sheet = null; $('#sheet').classList.add('hidden'); $('#sheetBox').innerHTML = ''; }

function foodRow(f, attrs) {
  return `<button class="food-res" ${attrs}><span><b>${esc(f.name)}</b><small>${f.brand ? esc(f.brand) : f.generic ? 'Generico' + (f.servingLabel ? ' · ' + esc(f.servingLabel) : '') : ''}</small></span>
    <span class="r"><b>${fmtNum(f.per100.kcal, 0)}</b><small>kcal/100g</small></span></button>`;
}

function renderSheet() {
  const s = foodState.sheet; if (!s) return;
  const meal = MEALS.find((m) => m.id === s.meal);
  let body = '';
  if (s.pick) {
    const f = s.pick, g = s.grams ?? f.serving ?? f.lastG ?? 100, n = nut({ g, per100: f.per100 });
    s.grams = g;
    body = `<button class="btn small ghost" data-action="sheetBack">‹ Indietro</button>
      <div><h3>${esc(f.name)}</h3><p class="muted small">${f.brand ? esc(f.brand) + ' · ' : ''}per 100 g: ${f.per100.kcal} kcal · P ${fmtNum(f.per100.p)} · C ${fmtNum(f.per100.c)} · G ${fmtNum(f.per100.f)}</p></div>
      <label class="qty">Quantità<span class="row"><input id="foodG" inputmode="decimal" value="${fmtNum(g, 1)}"><b>g</b></span></label>
      <div class="chips">${f.serving ? `<button class="chip" data-action="setG" data-g="${f.serving}">${f.servingLabel ? esc(f.servingLabel) : '1 porzione (' + f.serving + ' g)'}</button>` : ''}
        ${[30, 50, 100, 150, 200].map((x) => `<button class="chip" data-action="setG" data-g="${x}">${x} g</button>`).join('')}</div>
      <div class="preview" id="foodPrev">${previewHtml(n)}</div>
      <button class="btn primary wide" data-action="addFood">Aggiungi a ${meal.label}</button>`;
  } else {
    const tabs = [['cerca', 'Cerca'], ['recenti', 'Recenti'], ['pasti', 'Pasti salvati'], ['manuale', 'Manuale']];
    body = `<div class="seg wide">${tabs.map(([k, l]) => `<button class="${s.tab === k ? 'on' : ''}" data-action="sheetTab" data-t="${k}">${l}</button>`).join('')}</div>`;
    if (s.tab === 'cerca') {
      body += `<input id="foodQ" type="search" enterkeyhint="search" autocomplete="off" placeholder="Es. pasta, petto di pollo, mela…" value="${esc(s.query)}">
        <div id="resBox" class="res-list">${resultsHtml()}</div>`;
    } else if (s.tab === 'recenti') {
      const lib = [...(data.foods || [])].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 40);
      body += lib.length ? `<div class="res-list">${lib.map((f) => foodRow(f, `data-action="pickLib" data-id="${f.id}"`)).join('')}</div>`
        : '<p class="muted">Qui compariranno gli alimenti che usi, per ritrovarli al volo.</p>';
    } else if (s.tab === 'pasti') {
      const ms = data.meals || [];
      body += ms.length ? `<div class="list">${ms.map((m) => { const t = sumNut(m.items); return `<div class="li">
          <button class="food-name" data-action="useMeal" data-id="${m.id}"><b>${esc(m.name)}</b><small>${m.items.length} alimenti · ${fmtNum(t.kcal, 0)} kcal</small></button>
          <button class="icon" data-action="delMeal" data-id="${m.id}" aria-label="Elimina">✕</button></div>`; }).join('')}</div>`
        : '<p class="muted">Nessun pasto salvato. Quando un pasto ha più alimenti, tocca <b>☆ Salva come pasto</b> per riusarlo con un tocco.</p>';
    } else {
      body += `<p class="muted small">Copia i valori dall'etichetta (colonna "per 100 g").</p>
        <label class="block-l">Nome<input id="mName" placeholder="Es. Pane di casa"></label>
        <div class="form2">
          <label>Kcal / 100 g<input id="mKcal" inputmode="decimal"></label>
          <label>Proteine g<input id="mP" inputmode="decimal" placeholder="0"></label>
          <label>Carboidrati g<input id="mC" inputmode="decimal" placeholder="0"></label>
          <label>Grassi g<input id="mF" inputmode="decimal" placeholder="0"></label>
        </div>
        <p class="err" id="mErr"></p>
        <button class="btn primary wide" data-action="manualNext">Continua</button>`;
    }
  }
  $('#sheetBox').innerHTML = `<div class="row between"><h2>${meal.icon} Aggiungi a ${meal.label}</h2><button class="icon" data-action="sheetClose" aria-label="Chiudi">✕</button></div>${body}`;
}
function resultsHtml() {
  const s = foodState.sheet; if (!s) return '';
  const q = s.query.trim();
  if (q.length < 2) return '<p class="muted small">Scrivi un alimento: quelli generici compaiono mentre scrivi. Per un prodotto di marca o un codice a barre usa <b>Cerca tra le marche</b>.</p>';
  const loc = localSearch(q);
  const sameQuery = s.resultsFor === q;
  return `${loc.length ? `<p class="label">Generici</p>${loc.map((f) => foodRow(f, `data-action="pickGen" data-id="${f.id}"`)).join('')}`
      : '<p class="muted small">Nessun alimento generico con questo nome.</p>'}
    <p class="label">Prodotti di marca</p>
    ${s.loading ? '<p class="muted">Cerco…</p>' : s.err ? `<p class="err">${esc(s.err)}</p>` : ''}
    ${sameQuery && s.results ? (s.results.length ? s.results.map((f, i) => foodRow(f, `data-action="pickRes" data-i="${i}"`)).join('')
      : '<p class="muted small">Nessun prodotto trovato. Puoi inserirlo in <b>Manuale</b>.</p>')
      : s.loading ? '' : `<button class="btn wide" data-action="foodSearch">🔍 Cerca "${esc(q)}" tra le marche</button>`}`;
}
const previewHtml = (n) => `<b>${fmtNum(n.kcal, 0)} kcal</b><span>P ${fmtNum(n.p)} g</span><span>C ${fmtNum(n.c)} g</span><span>G ${fmtNum(n.f)} g</span>`;

async function doFoodSearch() {
  const s = foodState.sheet; if (!s) return;
  s.query = ($('#foodQ')?.value || '').trim();
  if (s.query.length < 2) return;
  if (mode() !== 'cloud') { s.err = 'La ricerca online funziona con la sincronizzazione attiva (Schede → Attiva sincronizzazione). Intanto usa "Manuale".'; renderSheet(); return; }
  s.loading = true; s.err = ''; s.results = null; s.resultsFor = s.query; refreshResults();
  try {
    const r = await fetch('/api/food?q=' + encodeURIComponent(s.query), { headers: { Authorization: 'Bearer ' + (localStorage.getItem(LS_PW) || '') } });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || 'Errore ' + r.status);
    if (foodState.sheet !== s) return;
    s.results = out.items || [];
  } catch (e) {
    s.err = navigator.onLine === false ? 'Sei offline: la ricerca richiede internet. Prova con "Recenti" o "Manuale".' : e.message;
  }
  s.loading = false; refreshResults();
}
function refreshResults() { const box = $('#resBox'); if (box) box.innerHTML = resultsHtml(); else renderSheet(); }

function upsertLibrary(f, g) {
  data.foods = data.foods || [];
  const key = (f.name + '|' + (f.brand || '')).toLowerCase();
  let lib = data.foods.find((x) => (x.name + '|' + (x.brand || '')).toLowerCase() === key);
  if (!lib) { lib = { id: uid(), name: f.name, brand: f.brand || '', code: f.code || '', per100: f.per100, serving: f.serving || null, servingLabel: f.servingLabel || '', generic: !!f.generic }; data.foods.push(lib); }
  lib.per100 = f.per100; lib.lastG = g; lib.lastUsed = Date.now();
  if (data.foods.length > 300) data.foods = data.foods.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 300);
}
function addFoodItems(meal, list) {
  data.food = data.food || {};
  const arr = data.food[ui.foodDate] || (data.food[ui.foodDate] = []);
  list.forEach((f) => { arr.push({ id: uid(), meal, name: f.name, brand: f.brand || '', g: f.g, per100: f.per100 }); upsertLibrary(f, f.g); });
}

Object.assign(actions, {
  foodDay: (b) => { const nd = shiftDate(ui.foodDate, +b.dataset.d); if (nd <= today()) { ui.foodDate = nd; render(); } },
  editProfile: () => { foodState.editProfile = true; foodState.profDraft = null; render(); },
  cancelProfile: () => { foodState.editProfile = false; foodState.profDraft = null; render(); },
  saveProfile: () => {
    const d = foodState.profDraft;
    const age = num(d.age), height = num(d.height), weight = num(d.weight);
    if (!age || age < 14 || age > 100) return toast('Inserisci un\'età valida');
    if (!height || height < 120 || height > 230) return toast('Inserisci l\'altezza in cm');
    if (!weight || weight < 30 || weight > 300) return toast('Inserisci il peso in kg');
    data.profile = { sex: d.sex, age, height, weight, activity: Number(d.activity), goal: d.goal };
    if (latestWeight() !== weight) { data.weights = data.weights.filter((w) => w.date !== today()); data.weights.push({ id: uid(), date: today(), kg: weight }); }
    foodState.editProfile = false; foodState.profDraft = null; save(); toast('Obiettivo calcolato');
  },
  openFoodSheet: (b) => openSheet(b.dataset.meal),
  sheetClose: closeSheet,
  sheetBackdrop: (b, ev) => { if (ev.target === b) closeSheet(); },
  sheetTab: (b) => { foodState.sheet.tab = b.dataset.t; renderSheet(); },
  sheetBack: () => { foodState.sheet.pick = null; foodState.sheet.grams = null; renderSheet(); },
  foodSearch: doFoodSearch,
  pickRes: (b) => { const s = foodState.sheet; const f = s.results[+b.dataset.i]; const lib = (data.foods || []).find((x) => x.name === f.name && x.brand === f.brand); s.pick = { ...f, lastG: lib?.lastG }; renderSheet(); },
  pickGen: (b) => { const g = GENERIC.find((x) => x.id === b.dataset.id); const lib = (data.foods || []).find((x) => x.name === g.name && !x.brand); foodState.sheet.pick = { ...g, lastG: lib?.lastG }; renderSheet(); },
  pickLib: (b) => { const f = data.foods.find((x) => x.id === b.dataset.id); foodState.sheet.pick = { ...f }; renderSheet(); },
  manualNext: () => {
    const name = $('#mName').value.trim(), kcal = num($('#mKcal').value);
    if (!name) { $('#mErr').textContent = 'Scrivi il nome'; return; }
    if (kcal == null || kcal < 0 || kcal > 900) { $('#mErr').textContent = 'Scrivi le kcal per 100 g'; return; }
    foodState.sheet.pick = { name, brand: '', per100: { kcal: Math.round(kcal), p: num($('#mP').value) || 0, c: num($('#mC').value) || 0, f: num($('#mF').value) || 0 } };
    renderSheet();
  },
  setG: (b) => { foodState.sheet.grams = +b.dataset.g; renderSheet(); },
  addFood: () => {
    const s = foodState.sheet, g = num($('#foodG').value);
    if (!g || g <= 0 || g > 5000) return toast('Inserisci i grammi');
    addFoodItems(s.meal, [{ ...s.pick, g }]);
    const m = MEALS.find((x) => x.id === s.meal);
    closeSheet(); save(); toast(`Aggiunto a ${m.label}`);
  },
  useMeal: (b) => {
    const m = data.meals.find((x) => x.id === b.dataset.id); const s = foodState.sheet;
    addFoodItems(s.meal, m.items.map((i) => ({ ...i })));
    closeSheet(); save(); toast(`"${m.name}" aggiunto`);
  },
  delMeal: (b) => { if (confirm('Eliminare questo pasto salvato?')) { data.meals = data.meals.filter((x) => x.id !== b.dataset.id); save(false); renderSheet(); } },
  saveMeal: (b) => {
    const its = dayFood(ui.foodDate).filter((i) => i.meal === b.dataset.meal);
    const def = MEALS.find((m) => m.id === b.dataset.meal).label;
    const name = (prompt('Nome del pasto (es. "La mia colazione")', 'La mia ' + def.toLowerCase()) || '').trim();
    if (!name) return;
    data.meals = data.meals || [];
    data.meals.push({ id: uid(), name, items: its.map(({ name, brand, g, per100 }) => ({ name, brand, g, per100 })) });
    save(); toast('Pasto salvato ☆');
  },
  editFood: (b) => {
    const it = dayFood(ui.foodDate)[+b.dataset.idx];
    const v = prompt(`Grammi di ${it.name}`, fmtNum(it.g, 1));
    if (v == null) return;
    const g = num(v); if (!g || g <= 0) return toast('Quantità non valida');
    it.g = g; save();
  },
  delFood: (b) => { data.food[ui.foodDate].splice(+b.dataset.idx, 1); save(); },
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.prof && foodState.profDraft) {
    foodState.profDraft[el.dataset.prof] = el.value;
    if (el.dataset.prof === 'weight') foodState.profDraft._wTouched = true;
  }
  if (el.id === 'foodQ' && foodState.sheet) { foodState.sheet.query = el.value; refreshResults(); }
  if (el.id === 'foodG' && foodState.sheet?.pick) {
    const g = num(el.value) || 0; foodState.sheet.grams = g;
    $('#foodPrev').innerHTML = previewHtml(nut({ g, per100: foodState.sheet.pick.per100 }));
  }
});
document.addEventListener('change', (ev) => { const el = ev.target; if (el.dataset.prof && foodState.profDraft) foodState.profDraft[el.dataset.prof] = el.value; });
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'foodQ') { ev.preventDefault(); doFoodSearch(); }
  if (ev.target.id === 'foodG') actions.addFood();
});

/* ---------- avvio ---------- */
render();
if (!mode()) showLogin(); else pull();
