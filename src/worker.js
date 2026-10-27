// Punto d'ingresso del Worker Cloudflare:
// /api/data → salvataggio e sincronizzazione dei dati
// tutto il resto → le pagine del diario (cartella public)
import { onRequest } from '../functions/api/data.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/data') return onRequest({ request, env });
    return env.ASSETS.fetch(request);
  },
};
