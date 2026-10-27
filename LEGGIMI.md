# Diario Palestra

Il diario è pubblicato su Cloudflare come **Worker** collegato a questo repository GitHub:
ogni modifica caricata qui viene ripubblicata automaticamente.

## Struttura

```
public/            ← il sito (pagine, stile, logica)
functions/api/     ← API che salva i dati (sincronizzazione)
src/food.js        ← ricerca alimenti su Open Food Facts (sezione Cibo)
src/worker.js      ← punto d'ingresso del Worker
wrangler.jsonc     ← configurazione Cloudflare (nome, database KV)
```

## Configurazione su Cloudflare

- Database KV `diario-dati`, collegato come `DIARIO` (già indicato in `wrangler.jsonc`)
- Password: in **Workers & Pages → diario-palestra → Settings → Variables and Secrets**,
  un **Secret** chiamato `APP_PASSWORD`

## Uso

- Apri l'indirizzo del Worker e inserisci la password.
- Sul telefono aggiungilo alla schermata Home per usarlo come un'app.
- Offline salva sul dispositivo e sincronizza appena torni online.
- Backup: *Schede → Impostazioni e backup → Esporta backup*.

## Provarlo in locale (facoltativo)

Crea `.dev.vars` con `APP_PASSWORD=prova`, poi `npx wrangler dev` e apri http://localhost:8787
