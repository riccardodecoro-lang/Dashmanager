import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} deve essere un numero (trovato "${v}")`);
  return n;
}
function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'si', 'sì'].includes(v.toLowerCase());
}

function loadWhales(file) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) {
    throw new Error(`File dei wallet da seguire non trovato: ${p}. Copia whales.example.json in whales.json e inserisci gli indirizzi.`);
  }
  const list = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${file} deve contenere almeno un wallet`);
  return list.map((w, i) => {
    const address = typeof w === 'string' ? w : w.address;
    if (!address) throw new Error(`${file}: voce ${i} senza "address"`);
    try { new PublicKey(address); } catch { throw new Error(`${file}: "${address}" non è un indirizzo Solana valido`); }
    return { address, label: (typeof w === 'object' && w.label) || address.slice(0, 4) + '…' + address.slice(-4) };
  });
}

export function loadConfig() {
  const live = bool('LIVE', false);
  const cfg = {
    root: ROOT,
    live,
    rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    privateKey: process.env.PRIVATE_KEY || '',
    jupiterUrl: (process.env.JUPITER_URL || 'https://lite-api.jup.ag/swap/v1').replace(/\/$/, ''),
    whales: loadWhales(process.env.WHALES_FILE || 'whales.json'),
    stateFile: path.resolve(ROOT, process.env.STATE_FILE || (live ? 'data/state-live.json' : 'data/state-paper.json')),

    // Capitale e dimensione
    budgetSol: num('BUDGET_SOL', 0.5),            // capitale massimo che il bot può usare
    tradeSol: num('TRADE_SOL', 0.05),              // SOL spesi per ogni acquisto
    maxOpenPositions: num('MAX_OPEN_POSITIONS', 5),
    reserveSol: num('RESERVE_SOL', 0.02),          // SOL lasciati sempre nel wallet per le fee
    maxDailyLossSol: num('MAX_DAILY_LOSS_SOL', 0.15),

    // Filtri sul segnale
    minWhaleBuySol: num('MIN_WHALE_BUY_SOL', 1),   // ignora gli acquisti piccoli della whale
    maxSignalAgeSec: num('MAX_SIGNAL_AGE_SEC', 60),
    minLiquidityUsd: num('MIN_LIQUIDITY_USD', 20000),
    minMcapUsd: num('MIN_MCAP_USD', 50000),
    maxMcapUsd: num('MAX_MCAP_USD', 50000000),
    minPairAgeMin: num('MIN_PAIR_AGE_MIN', 30),
    maxRoundTripLossPct: num('MAX_ROUND_TRIP_LOSS_PCT', 8),
    allowToken2022: bool('ALLOW_TOKEN_2022', false),
    cooldownMin: num('COOLDOWN_MIN', 60),          // non ricomprare lo stesso token per N minuti

    // Uscite
    stopLossPct: num('STOP_LOSS_PCT', 8),
    takeProfitPct: num('TAKE_PROFIT_PCT', 60),
    trailingActivatePct: num('TRAILING_ACTIVATE_PCT', 25),
    trailingStopPct: num('TRAILING_STOP_PCT', 12),
    maxHoldMin: num('MAX_HOLD_MIN', 240),
    followWhaleExit: bool('FOLLOW_WHALE_EXIT', true),

    // Esecuzione
    slippageBps: num('SLIPPAGE_BPS', 300),
    maxPriceImpactPct: num('MAX_PRICE_IMPACT_PCT', 3),
    priorityFeeMaxLamports: num('PRIORITY_FEE_MAX_LAMPORTS', 200000),

    // Ritmo
    pollWhalesSec: num('POLL_WHALES_SEC', 5),
    pollPositionsSec: num('POLL_POSITIONS_SEC', 10),

    // Dashboard
    port: num('PORT', 8787),
    host: process.env.HOST || '127.0.0.1',
  };

  if (cfg.live && !cfg.privateKey) throw new Error('LIVE=true richiede PRIVATE_KEY nel file .env');
  if (cfg.tradeSol <= 0 || cfg.tradeSol > cfg.budgetSol) throw new Error('TRADE_SOL deve essere > 0 e <= BUDGET_SOL');
  if (cfg.stopLossPct <= 0) throw new Error('STOP_LOSS_PCT deve essere > 0');
  return cfg;
}
