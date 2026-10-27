# Diario Palestra – guida alla pubblicazione su Cloudflare

Tempo richiesto: circa 15 minuti, una volta sola. Tutto gratuito.

## Cosa c'è nella cartella

```
diario-palestra/
├── public/          ← il sito (pagine, stile, logica)
└── functions/api/   ← il piccolo "server" che salva i dati per la sincronizzazione
```

## 1. Prepara il computer

1. Crea un account gratuito su https://dash.cloudflare.com/sign-up
2. Installa **Node.js** (versione LTS) da https://nodejs.org
3. Estrai lo zip e apri un terminale **dentro la cartella `diario-palestra`**
   - Windows: apri la cartella, clic sulla barra dell'indirizzo, scrivi `cmd` e premi Invio
   - Mac: tasto destro sulla cartella → "Nuovo terminale nella cartella"

## 2. Collega il terminale a Cloudflare

```
npx wrangler login
```
Si apre il browser: accedi e clicca **Allow**.

## 3. Crea il progetto e pubblica la prima volta

```
npx wrangler pages project create diario-palestra --production-branch main
npx wrangler pages deploy public --project-name diario-palestra
```
Alla fine vedrai un indirizzo tipo `https://diario-palestra-xxx.pages.dev`.
(Se il nome è già preso, usane un altro, es. `diario-palestra-paolo`, in entrambi i comandi.)

## 4. Crea il "database" per i tuoi dati

```
npx wrangler kv namespace create diario-dati
```

## 5. Collega database e password (dal sito di Cloudflare)

Vai su https://dash.cloudflare.com → **Workers & Pages** → **diario-palestra** → **Settings**.

**a) Database** – sezione *Bindings* → **Add** → **KV namespace**
- Variable name: `DIARIO` (esattamente così, maiuscolo)
- KV namespace: `diario-dati`
- Salva

**b) Password** – sezione *Variables and Secrets* → **Add**
- Type: **Secret**
- Variable name: `APP_PASSWORD`
- Value: la password che vuoi usare per entrare nel diario (scegline una robusta)
- Salva

Fai entrambe le cose per l'ambiente **Production**.

## 6. Ripubblica (per attivare le impostazioni)

```
npx wrangler pages deploy public --project-name diario-palestra
```

## 7. Usalo!

Apri l'indirizzo `https://diario-palestra….pages.dev`, inserisci la password e sei dentro.

**Sul telefono**: aprilo nel browser e aggiungilo alla schermata Home
(iPhone: Safari → Condividi → *Aggiungi alla schermata Home*; Android: Chrome → ⋮ → *Aggiungi a schermata Home*).
Si aprirà come un'app.

## Aggiornamenti futuri

Ogni volta che modifichiamo il diario, basta ripetere:
```
npx wrangler pages deploy public --project-name diario-palestra
```
I tuoi dati non si toccano: stanno nel database, separati dal sito.

## Note

- **Offline**: se in palestra non c'è campo, il diario salva tutto sul telefono e sincronizza appena torni online.
- **Backup**: in *Schede → Impostazioni e backup* puoi esportare tutti i dati in un file.
- **Limiti gratuiti**: Cloudflare concede 1.000 salvataggi al giorno, molto più di quanto serve.
- **Problemi?** Se dopo il login vedi "KV DIARIO non collegato" o "APP_PASSWORD non impostata", ricontrolla il passo 5 e poi ripubblica (passo 6).

## Provarlo sul computer prima di pubblicare (facoltativo)

Crea un file `.dev.vars` nella cartella con dentro `APP_PASSWORD=prova`, poi:
```
npx wrangler pages dev public --kv DIARIO
```
e apri http://localhost:8788
