// Punto d'ingresso del Worker Cloudflare:
// /api/data → salvataggio e sincronizzazione dei dati
// /api/food → ricerca alimenti (Open Food Facts)
// /api/health → dati di Apple Salute inviati dal Comando Rapido dell'iPhone
// tutto il resto → le pagine del diario (cartella public)
import { onRequest, isAuthorized } from '../functions/api/data.js';
import { foodSearch } from './food.js';
import { healthImport } from './health.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/data') return onRequest({ request, env });
    if (url.pathname === '/api/health') {
      if (!isAuthorized(request, env)) return new Response('{"error":"Password errata"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
      return healthImport(request, env);
    }
    if (url.pathname === '/api/food') {
      if (!isAuthorized(request, env)) return new Response('{"error":"Password errata"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
      return foodSearch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
