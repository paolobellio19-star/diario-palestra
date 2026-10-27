// Riceve i dati di Apple Salute inviati dal Comando Rapido dell'iPhone
// e li aggiunge al diario. Il Comando Rapido invia un testo, una riga per dato:
//   passi;2026-10-26;8432
//   kcal;2026-10-26;512,4
//   sonno;2026-10-26 23:40;2026-10-27 06:55;Principale
// I dati dei giorni passati vengono sovrascritti (così si correggono da soli),
// tranne i valori che hai modificato a mano nel diario.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const TZ = 'Europe/Rome';
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

// "8.432 passi" → 8432 · "512,4 kcal" → 512.4 · "1.234,5" → 1234.5 · "512.4" → 512.4
export function parseNumber(raw) {
  let t = String(raw || '').replace(/[^\d.,-]/g, '');
  if (!t) return null;
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    t = t.replace(dec === '.' ? /,/g : /\./g, '').replace(dec, '.');
  } else if (lastComma >= 0) {
    t = /,\d{3}$/.test(t) && t.split(',').length > 2 ? t.replace(/,/g, '') : t.replace(/,/g, '.');
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // separatore delle migliaia
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// Accetta "2026-10-26", "2026-10-26 23:40", "2026-10-26T23:40:00+01:00", "26/10/2026 23:40"
export function parseLocal(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:.](\d{2}))?/);
  if (!m) {
    const it = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2})[:.](\d{2}))?/);
    if (it) m = [it[0], it[3], it[2], it[1], it[4], it[5]];
  }
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0'] = m;
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { date, minutes: Date.UTC(+y, +mo - 1, +d, +h, +mi) / 60000 };
}

const NOT_ASLEEP = /letto|bed|svegl|awake/i;

export function parseLines(text) {
  const out = { steps: {}, kcal: {}, sleep: [], errors: 0 };
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(';').map((p) => p.trim());
    if (parts.length < 3 || !parts[0]) continue;
    const type = parts[0].toLowerCase();
    if (/^(passi|steps)/.test(type)) {
      const d = parseLocal(parts[1]), v = parseNumber(parts[2]);
      if (d && v != null) out.steps[d.date] = (out.steps[d.date] || 0) + v; else out.errors++;
    } else if (/^(kcal|calorie|energia|energy)/.test(type)) {
      const d = parseLocal(parts[1]), v = parseNumber(parts[2]);
      if (d && v != null) out.kcal[d.date] = (out.kcal[d.date] || 0) + v; else out.errors++;
    } else if (/^(sonno|sleep)/.test(type)) {
      const a = parseLocal(parts[1]), b = parseLocal(parts[2]);
      if (!a || !b || b.minutes <= a.minutes) { out.errors++; continue; }
      if (NOT_ASLEEP.test(parts[3] || '')) continue;
      out.sleep.push({ start: a.minutes, end: b.minutes, wake: b.date });
    }
  }
  return out;
}

// Somma il sonno per "giorno di risveglio", unendo i periodi sovrapposti
// (es. iPhone e Apple Watch registrano la stessa notte).
export function sleepByDay(intervals) {
  const byDay = {};
  const sorted = [...intervals].sort((x, y) => x.start - y.start);
  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) { if (iv.end > last.end) { last.end = iv.end; last.wake = iv.wake; } }
    else merged.push({ ...iv });
  }
  for (const iv of merged) byDay[iv.wake] = (byDay[iv.wake] || 0) + (iv.end - iv.start);
  return byDay;
}

export async function healthImport(request, env) {
  if (request.method !== 'POST' && request.method !== 'PUT') return json({ error: 'Usa POST' }, 405);
  const text = await request.text();
  const parsed = parseLines(text);
  const sleep = sleepByDay(parsed.sleep);
  const today = localToday();

  const data = (await env.DIARIO.get('data', 'json')) || { version: 1, updatedAt: 0, routines: [], workouts: [], weights: [], active: null };
  data.health = data.health || {};
  const touched = new Set();
  const set = (date, field, value) => {
    const day = data.health[date] || (data.health[date] = {});
    if (day.manual && day.manual[field]) return; // corretto a mano: non lo tocco
    day[field] = value; touched.add(date);
  };
  // passi e calorie: solo giorni conclusi (oggi è ancora in corso)
  for (const [d, v] of Object.entries(parsed.steps)) if (d < today) set(d, 'steps', Math.round(v));
  for (const [d, v] of Object.entries(parsed.kcal)) if (d < today) set(d, 'kcal', Math.round(v));
  for (const [d, v] of Object.entries(sleep)) if (d <= today && v >= 30 && v <= 20 * 60) set(d, 'sleep', Math.round(v));

  const days = [...touched].sort();
  data.healthSync = { at: Date.now(), days: days.length, last: days[days.length - 1] || null };
  data.updatedAt = Date.now();
  await env.DIARIO.put('data', JSON.stringify(data));

  const msg = days.length
    ? `Diario aggiornato: ${days.length} ${days.length === 1 ? 'giorno' : 'giorni'} (fino al ${days[days.length - 1].split('-').reverse().join('/')}).`
    : 'Nessun dato nuovo da aggiornare.';
  return json({ ok: true, message: msg, days, errors: parsed.errors });
}
