# CZ Streams

Stremio addon pre streamovanie filmov a seriálov z českých a slovenských zdrojov.

## Zdroje

| Zdroj | Vyžaduje login | Status |
|-------|---------------|--------|
| **Prehraj.to** | Voliteľný (premium) | ✅ Aktívny |
| **HellSpy** | Nie | ✅ Aktívny — API hellspy.to/gw |
| **SOSAC** | Nie | ✅ Aktívny — JSON API + streamuj.tv |
| **WebShare** | Áno | ✅ Aktívny (s prihlásením) |
| FastShare | Nie | ❌ Free streaming zrušený |
| **Sledujte.to** | Voliteľný | ✅ Aktívny — nové API |

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

Prehraj.to funguje aj anonymne (obmedzenejšie výsledky). WebShare vyžaduje prihlásenie. HellSpy a SOSAC fungujú bez prihlásenia. Sledujte.to funguje aj anonymne (obmedzená dĺžka prehrávania).

## Ako to funguje

1. Stremio pošle IMDb ID (`tt1234567`) na `/stream` endpoint
2. Addon načíta meta z Cinemeta + TMDB (názvy, rok, sezóna/epizóda)
3. Všetky aktívne resolvery paralelne prehľadávajú svoje zdroje
4. Výsledky sa ohodnotia scoring systémom (názov, epizóda, rok, runtime, veľkosť, kľúčové slová)
5. Najlepšie výsledky sa vrátia do Stremia (5-minútová cache pre opakované dotazy)
6. Po kliknutí na stream addon presmeruje (301 redirect) na reálne video

Addon podporuje aj textové vyhľadávanie priamo zo Stremio katalógu.

## Technické detaily

- TypeScript, Node.js 18+, Express 5
- `stremio-addon-sdk` pre kompatibilitu
- `linkedom` pre HTML parsing (rýchlejší ako JSDOM)
- `crypto-js` pre AES dešifrovanie (SOSAC, WebShare)
- `moviedb-promise` pre TMDB API
- In-memory cache s TTL pre vyhľadávanie a metadata
- Každý zdroj je samostatný resolver s jednotným rozhraním (search → score → resolve)
- Scraping na strane servera, Stremio dostáva priame video linky (cez 301 redirect)

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
| `/media/<resolver>/<id>` | Resolvuje a presmeruje na video URL (301) |
| `/test/?q=<query>` | Debug endpoint pre testovanie resolverov |
| `/clean/` | Manuálne vyčistenie cache |
