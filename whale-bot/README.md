# Whale Bot

Bot di copy trading per Solana. Segue i wallet che scegli tu e, quando uno compra un token, valuta se comprarlo anche lui con un importo fisso. Fa i trade tramite Jupiter, gestisce lo stop loss e le altre uscite, e ha una dashboard nello stile delle app "whale bot", che però mostra solo numeri reali.

> **Leggi prima di usarlo con soldi veri.** Il copy trading su memecoin perde soldi nella maggior parte dei casi. Quando vedi la transazione della whale, il prezzo si è già mosso. Molti "smart wallet" guadagnano proprio vendendo a chi li copia. Gli stop loss su token poco liquidi scattano spesso molto sotto il livello impostato. Nessun bot onesto può prometterti di trasformare 77 $ in 1.963 $ in una notte. Usa un wallet nuovo, con dentro solo quello che sei pronto a perdere.

## Come funziona

1. **Osserva** ogni pochi secondi le transazioni dei wallet in `whales.json` e riconosce le swap SOL/USDC ↔ token.
2. **Filtra** ogni acquisto della whale con il risk manager. Il bot non compra se:
   - la whale ha speso poco (`MIN_WHALE_BUY_SOL`) o il segnale è vecchio;
   - il token ha la **mint authority** (possono stampare token) o la **freeze authority** (possono bloccarti i token) ancora attive;
   - è un Token-2022 (può avere tasse nascoste), salvo `ALLOW_TOKEN_2022=true`;
   - liquidità, market cap o età della pool sono fuori dai limiti;
   - il **test anti-honeypot** fallisce: il bot chiede a Jupiter di comprare e poi rivendere subito, e se si perde più di `MAX_ROUND_TRIP_LOSS_PCT` scarta il token;
   - il price impact è troppo alto, il budget è finito, ci sono troppe posizioni aperte, il token è in cooldown o è stato superato il limite di perdita giornaliera.
3. **Compra** `TRADE_SOL` via Jupiter e registra il costo reale, con fee e rent inclusi.
4. **Esce** con il primo di questi eventi: stop loss, take profit, trailing stop, vendita della whale copiata, tempo massimo di tenuta, oppure il tuo pulsante "Vendi". Il valore della posizione viene calcolato come i SOL che otterresti vendendo davvero adesso, non con il prezzo teorico. Se una vendita fallisce, il bot riprova alzando lo slippage, fino a un massimo del 15%.

## Installazione

Serve Node.js 20 o più recente.

```bash
cd whale-bot
npm install
cp .env.example .env
cp whales.example.json whales.json
```

Poi:

- In `whales.json` metti gli indirizzi dei wallet da seguire. Puoi trovarli su GMGN, Birdeye o Solscan. Prima di copiarli guarda il loro storico su più settimane, non i risultati di un solo giorno.
- In `.env` metti una **RPC privata** in `RPC_URL`: quella pubblica di Solana blocca il bot dopo poche richieste. Helius ha un piano gratuito.

## 1. Prima in simulazione

```bash
npm start
```

Apri http://127.0.0.1:8787. Con `LIVE=false` il bot segue wallet e prezzi veri, ma i trade sono virtuali. Lascialo girare qualche giorno: se in simulazione perde, con soldi veri perderà di più, perché si aggiungono fee, slippage e ritardi.

## 2. Poi con soldi veri

1. Crea un **wallet nuovo** in Phantom, solo per il bot, e mandaci pochi SOL: il budget più circa 0,05 SOL per le fee.
2. Esporta la chiave privata (Phantom → Impostazioni → Gestisci account → Mostra chiave privata) e incollala in `PRIVATE_KEY` nel file `.env`. Non condividerla con nessuno e non caricarla su GitHub: `.env` è già escluso da git.
3. Imposta `LIVE=true` e riavvia con `npm start`.

Simulazione e soldi veri usano file di stato diversi (`data/state-paper.json` e `data/state-live.json`). Se fermi il bot con Ctrl+C, le posizioni aperte restano nel wallet e vengono riprese al prossimo avvio.

## Dashboard

- Valore attuale, profitto, moltiplicatore, grafico del valore nel tempo.
- Posizioni aperte con il profitto o la perdita attuali, e un pulsante **Vendi** per ognuna.
- Registro di ogni decisione: acquisti, vendite, segnali scartati con il motivo, errori.
- Riepilogo: trade, win rate, migliore e peggiore.
- **Pausa acquisti** e **Vendi tutto**.

La dashboard è raggiungibile solo dal computer su cui gira il bot (`HOST=127.0.0.1`). Per aprirla dal telefono usa un tunnel privato come Tailscale, oppure imposta `HOST=0.0.0.0` insieme a un `DASHBOARD_TOKEN` lungo e casuale.

## Test

```bash
npm test
```

I test controllano il riconoscimento delle swap, ogni regola del risk manager e un ciclo completo del bot con Jupiter e la blockchain simulati: acquisto, stop loss, uscita quando vende la whale e vendita manuale.

## File

| File | Cosa fa |
|---|---|
| `src/index.js` | avvio e cicli di controllo |
| `src/bot.js` | ingressi, uscite, esecuzione, contabilità |
| `src/risk.js` | regole d'ingresso e di uscita |
| `src/swapParser.js` | riconosce acquisti e vendite nelle transazioni |
| `src/jupiter.js` | quotazioni e swap su Jupiter |
| `src/chain.js` | lettura saldi, mint e transazioni via RPC |
| `src/market.js` | liquidità e market cap da DexScreener |
| `src/server.js`, `public/index.html` | dashboard |
