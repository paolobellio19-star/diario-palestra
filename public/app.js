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

const emptyData = () => ({ version: 1, updatedAt: 0, routines: [], workouts: [], weights: [], videos: {}, active: null });
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
function alarm() {
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  toast('Recupero finito! 💪');
  if (!actx) return;
  [0, 0.28, 0.56].forEach((t) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
    const st = actx.currentTime + t;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.5, st + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
    o.start(st); o.stop(st + 0.25);
  });
}

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
const setsText = (sets) => sets.map((s) => `${s.reps ?? '?'}${s.kg != null ? '×' + fmtNum(s.kg) + 'kg' : ''}`).join(' · ');
const maxKg = (sets) => { const k = sets.map((s) => s.kg).filter((v) => v != null); return k.length ? Math.max(...k) : null; };

function datalist() { return `<datalist id="exList">${exerciseNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`; }

/* ---------- video esercizi ---------- */
const videoKey = (name) => name.trim().toLowerCase();
const videoFor = (name) => (data.videos || {})[videoKey(name)] || '';
function videoBtn(name) {
  const has = !!videoFor(name);
  return `<button class="vbtn ${has ? 'has' : ''}" data-action="video" data-name="${esc(name)}" aria-label="Video di ${esc(name)}" title="${has ? 'Guarda il video' : 'Aggiungi un video'}">▶</button>`;
}
function youtubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^(www|m)\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    if (h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
      if (m) return m[2];
    }
  } catch { /* non è un URL */ }
  return null;
}
let videoName = '';
function openVideo(name, editing = false) {
  videoName = name;
  const url = videoFor(name);
  const id = url && youtubeId(url);
  const search = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' esecuzione corretta');
  let body;
  if (url && !editing) {
    body = (id
      ? `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&playsinline=1" title="Video ${esc(name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
      : `<a class="btn primary wide" href="${esc(url)}" target="_blank" rel="noopener">Apri il video ↗</a>`) +
      `<div class="row"><button class="btn small" data-action="videoEdit">Cambia video</button><button class="btn small ghost danger" data-action="videoRemove">Rimuovi</button></div>`;
  } else {
    body = `<ol class="steps">
        <li><a class="btn wide" href="${search}" target="_blank" rel="noopener">🔍 Cerca "${esc(name)}" su YouTube</a></li>
        <li>Scegli un video, tocca <b>Condividi → Copia link</b></li>
        <li>Incollalo qui sotto:</li>
      </ol>
      <div class="row"><input id="videoUrl" type="url" inputmode="url" placeholder="https://youtu.be/…" value="${esc(url)}"><button class="btn primary" data-action="videoSave">Salva</button></div>
      <p class="err" id="videoErr"></p>`;
  }
  $('#videoBox').innerHTML = `<div class="row between"><h2>${esc(name)}</h2><button class="icon" data-action="videoClose" aria-label="Chiudi">✕</button></div>${body}`;
  $('#videoModal').classList.remove('hidden');
}
function closeVideo() { $('#videoModal').classList.add('hidden'); $('#videoBox').innerHTML = ''; }

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

function entryCard(e, i) {
  const prev = lastEntryFor(e.name);
  return `<section class="card">
    <div class="row between"><div class="row"><h3>${esc(e.name)}</h3>${videoBtn(e.name)}</div><button class="icon" data-action="removeEntry" data-i="${i}" aria-label="Rimuovi esercizio">✕</button></div>
    ${prev ? `<p class="muted small">Ultima volta (${fmtShort(prev.w.date)}): ${setsText(prev.e.sets)}</p>` : ''}
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
  const pts = ws.slice().reverse().map((w) => {
    const e = w.entries.find((x) => x.name === ui.histEx);
    const k = e ? maxKg(e.sets) : null;
    return k != null ? { x: w.date, y: k } : null;
  }).filter(Boolean);
  const best = pts.length ? Math.max(...pts.map((p) => p.y)) : null;

  return `<section class="card"><h2>I tuoi numeri</h2>
      <div class="stats">
        <div class="stat"><b>${thisWeek}</b><span>ultimi 7 giorni</span></div>
        <div class="stat"><b>${thisMonth}</b><span>questo mese</span></div>
        <div class="stat"><b>${ws.length}</b><span>totali</span></div>
      </div></section>
    <section class="card"><p class="label">Progressi per esercizio (carico massimo)</p>
      ${names.length ? `<select data-action-change="histEx">${names.map((n) => `<option ${n === ui.histEx ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${best != null ? `<p class="muted small">Record: <b class="pos">${fmtNum(best)} kg</b></p>` : '<p class="muted small">Nessun carico registrato per questo esercizio.</p>'}
      ${chart(pts, 'kg')}` : ''}
    </section>
    <section class="card"><p class="label">Allenamenti</p><div class="list">
      ${ws.map((w) => `<details class="workout li">
        <summary><div><b>${esc(w.name)}</b><div class="muted small">${fmtDate(w.date)}${w.duration ? ' · ' + w.duration + ' min' : ''} · ${w.entries.length} esercizi</div></div></summary>
        <div class="detail">
          ${w.entries.map((e) => `<div class="ex-line"><b>${esc(e.name)} ${videoBtn(e.name)}</b><span>${setsText(e.sets)}</span></div>`).join('')}
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
        <div class="name"><input list="exList" data-item="${i}.name" value="${esc(it.name)}" placeholder="Esercizio">${it.name ? videoBtn(it.name) : ''}<button class="icon" data-action="removeItem" data-i="${i}" aria-label="Rimuovi">✕</button></div>
        <label>Serie<input inputmode="numeric" data-item="${i}.sets" value="${it.sets ?? ''}"></label>
        <label>Ripetiz.<input inputmode="numeric" data-item="${i}.reps" value="${it.reps ?? ''}"></label>
        <label>Kg<input inputmode="decimal" data-item="${i}.kg" value="${it.kg ?? ''}" placeholder="auto"></label>
        <label>Recup. s<input inputmode="numeric" data-item="${i}.rest" value="${it.rest ?? ''}"></label>
      </div>`).join('')}
      <button class="btn wide" data-action="addItem">+ Aggiungi esercizio</button>
      <div class="row"><button class="btn ghost wide" data-action="cancelDraft">Annulla</button><button class="btn primary wide" data-action="saveDraft">Salva scheda</button></div>
      <p class="muted small">Se lasci vuoti i Kg, all'avvio verranno proposti quelli dell'ultima volta.</p>
      ${datalist()}`;
  }
  return `<section class="card"><div class="row between"><h2>Le tue schede</h2><button class="btn primary small" data-action="newRoutine">+ Nuova</button></div>
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
  const views = { oggi: viewOggi, storico: viewStorico, peso: viewPeso, schede: viewSchede };
  $('#view').innerHTML = views[tab]();
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

/* ---------- azioni ---------- */
function newWorkout(name, entries, routineId = null) {
  data.active = { id: uid(), date: today(), startTime: nowTime(), startedAt: Date.now(), name, routineId, entries, notes: '' };
}
function setsFromLast(name, n, reps, kg) {
  const prev = lastEntryFor(name);
  return Array.from({ length: n }, (_, j) => {
    const ps = prev?.e.sets[j] || prev?.e.sets[prev.e.sets.length - 1];
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
    newWorkout(r.name, r.items.map((it) => ({ name: it.name, rest: it.rest ?? 90, sets: setsFromLast(it.name, it.sets || 3, it.reps ?? null, it.kg ?? null) })), r.id);
    save();
  },
  repeatWorkout: (b) => {
    if (data.active && !confirm('Hai già un allenamento in corso. Sostituirlo?')) return;
    const w = data.workouts.find((x) => x.id === b.dataset.id); if (!w) return;
    newWorkout(w.name, w.entries.map((e) => ({ name: e.name, rest: e.rest ?? 90, sets: e.sets.map((s) => ({ reps: s.reps, kg: s.kg, done: false })) })), w.routineId);
    tab = 'oggi'; save(); window.scrollTo(0, 0);
  },
  addEntry: () => {
    const name = $('#newEx').value.trim(); if (!name) return $('#newEx').focus();
    const prev = lastEntryFor(name);
    data.active.entries.push({ name, rest: prev?.e.rest ?? 90, sets: setsFromLast(name, prev?.e.sets.length || 3, null, null) });
    save();
  },
  removeEntry: (b) => { if (confirm('Rimuovere questo esercizio?')) { data.active.entries.splice(+b.dataset.i, 1); save(); } },
  addSet: (b) => { const e = data.active.entries[+b.dataset.i]; const l = e.sets[e.sets.length - 1]; e.sets.push({ reps: l?.reps ?? null, kg: l?.kg ?? null, done: false }); save(); },
  removeSet: (b) => { data.active.entries[+b.dataset.i].sets.pop(); save(); },
  toggleSet: (b) => {
    const e = data.active.entries[+b.dataset.i]; const s = e.sets[+b.dataset.j];
    s.done = !s.done;
    if (s.done) startTimer(e.rest || 90);
    save();
  },
  cancelWorkout: () => { if (confirm('Annullare l\'allenamento in corso? Non verrà salvato.')) { data.active = null; stopTimer(); save(); } },
  finishWorkout: () => {
    const a = data.active;
    const entries = a.entries.map((e) => ({ name: e.name, rest: e.rest, sets: e.sets.filter((s) => s.done).map(({ reps, kg }) => ({ reps, kg })) }))
      .filter((e) => e.sets.length);
    if (!entries.length) { alert('Spunta ✓ almeno una serie completata prima di salvare.'); return; }
    const skipped = a.entries.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    if (skipped && !confirm(`${skipped} serie non spuntate non verranno salvate. Continuare?`)) return;
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
  video: (b) => openVideo(b.dataset.name),
  videoClose: closeVideo,
  videoBackdrop: (b, ev) => { if (ev.target === b) closeVideo(); },
  videoEdit: () => openVideo(videoName, true),
  videoRemove: () => {
    if (!confirm('Rimuovere il video di questo esercizio?')) return;
    delete data.videos[videoKey(videoName)]; save(); openVideo(videoName);
  },
  videoSave: () => {
    let url = $('#videoUrl').value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch { $('#videoErr').textContent = 'Incolla un link valido (es. https://youtu.be/…)'; return; }
    data.videos = data.videos || {};
    data.videos[videoKey(videoName)] = url;
    save(); openVideo(videoName); toast('Video salvato');
  },
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
  if (ev.target.id === 'videoUrl') actions.videoSave();
});

/* ---------- avvio ---------- */
render();
if (!mode()) showLogin(); else pull();
