# CZ Streams

Stremio addon pre streamovanie filmov a seriálov z českých a slovenských zdrojov.

## Zdroje

| Zdroj | Vyžaduje login | Status |
|-------|---------------|--------|
| **Prehraj.to** | Voliteľný (premium) | ✅ Aktívny |
| **HellSpy** | Nie | ✅ Aktívny |
| **SOSAC** | Nie | ✅ Aktívny |
| **WebShare** | Áno | ✅ Aktívny (s prihlásením) |
| FastShare | Nie | ❌ Seek nefunguje |
| Sledujte.to | Áno | ❌ 30s keepalive |

## Inštalácia

```
npm install
npm start
```

Addon beží na porte 52932 (alebo $PORT).

Do Stremia pridaj:
```
http://localhost:52932/manifest.json
```

### Konfigurácia cez Stremio
Addon je configurable — v Stremio UI vieš nastaviť:
- **PrehrajTo username/password** — pre premium streamy
- **WebShare username/password** — pre prístup k WebShare

Bez prihlásenia fungujú HellSpy a SOSAC automaticky.

## Ako to funguje

1. Stremio pošle IMDb ID (`tt1234567`) na `/stream` endpoint
2. Addon načíta meta z Cinemeta + TMDB (názvy, rok, sezóna/epizóda)
3. Všetky aktívne resolvery paralelne prehľadávajú svoje zdroje
4. Výsledky sa ohodnotia scoring systémom (názov, epizóda, rok, runtime, veľkosť, kvalita)
5. Najlepšie výsledky sa vrátia do Stremia
6. Keď používateľ klikne na stream, addon cez `/media/` proxy presmeruje na reálne video

## Technické detaily

- TypeScript, Node.js 18+, Express 5
- `stremio-addon-sdk` pre kompatibilitu
- `linkedom` pre HTML parsing (rýchlejší ako JSDOM)
- `crypto-js` pre AES dešifrovanie (SOSAC, WebShare)
- Scraping na strane servera, Stremio dostáva priame video linky

## Deployment

### Lokálne
```bash
npm start
```

### Beamup
```bash
npm run deploy
```

### Vlastný server
Nastav `$PORT` a spusti:
```bash
node --experimental-strip-types server.ts
```
