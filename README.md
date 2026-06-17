# CZ Streams

Stremio addon pre streamovanie filmov a seriálov z českých a slovenských zdrojov.

## Zdroje

| Zdroj | Vyžaduje login | Status |
|-------|---------------|--------|
| **WebShare** | Áno | ✅ Aktívny (s prihlásením) |
| **HellSpy** | Nie | ✅ Aktívny — API hellspy.to/gw |
| **Prehraj.to** | Voliteľný (premium) | ✅ Aktívny |

## Inštalácia

```bash
npm install
npm start        # bežné spustenie
npm run start:install  # spustenie + vyžiada inštaláciu
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
- **Zoradenie výsledkov** — Default / Podle velikosti / Podle kvality
- **Skryť z globálneho vyhľadávania** — checkbox pre vypnutie z celosietového vyhľadávania

Prehraj.to funguje aj anonymne (obmedzenejšie výsledky). WebShare vyžaduje prihlásenie. HellSpy funguje bez prihlásenia.

## Ako to funguje

1. Stremio pošle IMDb ID (`tt1234567`) na `/stream` endpoint
2. Addon načíta meta z Cinemeta + TMDB (názvy, rok, sezóna/epizóda)
3. Všetky aktívne resolvery paralelne prehľadávajú svoje zdroje
4. Výsledky sa ohodnotia scoring systémom (názov, epizóda, rok, runtime, veľkosť, kľúčové slová)
5. Najlepšie výsledky sa vrátia do Stremia (5-minútová cache pre opakované dotazy)
6. Po kliknutí na stream addon proxyje video z CDN cez Pi server

Addon podporuje aj textové vyhľadávanie priamo zo Stremio katalógu.

## Technické detaily

- TypeScript, Node.js 18+, Express 5
- `stremio-addon-sdk` pre kompatibilitu
- `linkedom` pre HTML parsing (rýchlejší ako JSDOM)
- `crypto-js` pre AES dešifrovanie (WebShare)
- `moviedb-promise` pre TMDB API
- In-memory cache s TTL pre vyhľadávanie a metadata
- Každý zdroj je samostatný resolver s jednotným rozhraním (search → score → resolve)
- Scraping HTML (PrehrajTo, WebShare) + JSON API (HellSpy)
- Stremio dostáva video cez proxy (CDN → Pi server → klient)

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

## Endpointy

| Endpoint | Účel |
|----------|------|
| `/configure` | Konfiguračné UI v prehliadači |
| `/media/<resolver>/<id>` | Proxy videa z CDN cez server |
| `/test/?q=<query>` | Debug endpoint pre testovanie resolverov |
| `/clean/` | Manuálne vyčistenie cache |
