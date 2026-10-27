// Ricerca alimenti su Open Food Facts (database gratuito e aperto).
// Il Worker fa da tramite: il sito chiama /api/food?q=... e riceve una lista
// già "pulita" con calorie e macro per 100 g.

const UA = 'DiarioPalestra/1.0 (uso personale)';
const FIELDS = 'code,product_name,product_name_it,generic_name_it,brands,nutriments,serving_quantity,serving_size,quantity';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

const round1 = (n) => Math.round(n * 10) / 10;
const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function normalize(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let kcal = toNum(n['energy-kcal_100g']);
  if (kcal == null) {
    const kj = toNum(n['energy-kj_100g']) ?? toNum(n.energy_100g);
    if (kj != null) kcal = kj / 4.184;
  }
  const name = (p.product_name_it || p.product_name || p.generic_name_it || '').trim();
  if (!name || kcal == null) return null;
  const brands = Array.isArray(p.brands) ? p.brands.join(', ') : (p.brands || '');
  const serving = toNum(p.serving_quantity);
  return {
    code: String(p.code || ''),
    name,
    brand: brands.split(',')[0].trim(),
    per100: {
      kcal: Math.round(kcal),
      p: round1(toNum(n.proteins_100g) ?? 0),
      c: round1(toNum(n.carbohydrates_100g) ?? 0),
      f: round1(toNum(n.fat_100g) ?? 0),
    },
    serving: serving && serving > 0 && serving < 2000 ? Math.round(serving) : null,
    servingLabel: p.serving_size || '',
  };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function byBarcode(code) {
  const d = await getJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`);
  const item = d && d.status === 1 ? normalize({ ...d.product, code }) : null;
  return item ? [item] : [];
}

async function byText(q) {
  const terms = encodeURIComponent(q);
  // 1° tentativo: ricerca classica, privilegiando i prodotti venduti in Italia
  try {
    const d = await getJson(`https://it.openfoodfacts.org/cgi/search.pl?search_terms=${terms}&search_simple=1&action=process&json=1&page_size=30&sort_by=unique_scans_n&fields=${FIELDS}`);
    const items = (d.products || []).map(normalize).filter(Boolean);
    if (items.length) return items;
  } catch { /* provo il motore alternativo */ }
  // 2° tentativo: nuovo motore di ricerca di Open Food Facts
  const d = await getJson(`https://search.openfoodfacts.org/search?q=${terms}&langs=it&page_size=30&fields=${FIELDS}`);
  return (d.hits || []).map(normalize).filter(Boolean);
}

export async function foodSearch(request) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 2) return json({ items: [] });
  try {
    const items = /^\d{8,14}$/.test(q) ? await byBarcode(q) : await byText(q);
    // tolgo i doppioni (stesso nome e marca)
    const seen = new Set();
    const unique = items.filter((i) => {
      const k = (i.name + '|' + i.brand).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, 25);
    return json({ items: unique });
  } catch (e) {
    return json({ error: 'Database alimenti non raggiungibile, riprova tra poco.' }, 502);
  }
}
