import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEntry, checkExit } from '../src/risk.js';

const cfg = {
  budgetSol: 0.5, tradeSol: 0.05, maxOpenPositions: 5, reserveSol: 0.02, maxDailyLossSol: 0.15,
  minWhaleBuySol: 1, maxSignalAgeSec: 60, minLiquidityUsd: 20000, minMcapUsd: 50000, maxMcapUsd: 5e7,
  minPairAgeMin: 30, maxRoundTripLossPct: 8, allowToken2022: false, cooldownMin: 60, maxPriceImpactPct: 3,
  stopLossPct: 8, takeProfitPct: 60, trailingActivatePct: 25, trailingStopPct: 12, maxHoldMin: 240, followWhaleExit: true,
};
const now = 1_800_000_000_000;
const base = () => ({
  signal: { mint: 'M', quote: 'SOL', quoteAmount: 3, blockTime: now / 1000 - 5 },
  market: { liquidityUsd: 80000, mcapUsd: 900000, pairAgeMin: 600 },
  mintInfo: { mintAuthority: null, freezeAuthority: null, isToken2022: false },
  roundTripLossPct: 2, priceImpactPct: 0.5, walletSol: 1, solUsd: 150, cfg, now,
  state: { paused: false, positions: {}, closed: [], cooldowns: {} },
});

test('segnale buono passa', () => assert.equal(checkEntry(base()).ok, true));

const cases = {
  'pausa': (a) => { a.state.paused = true; },
  'segnale vecchio': (a) => { a.signal.blockTime = now / 1000 - 300; },
  'whale piccola': (a) => { a.signal.quoteAmount = 0.3; },
  'whale piccola in USDC': (a) => { a.signal = { ...a.signal, quote: 'USD', quoteAmount: 100 }; },
  'mint authority': (a) => { a.mintInfo.mintAuthority = 'X'; },
  'freeze authority': (a) => { a.mintInfo.freezeAuthority = 'X'; },
  'token-2022': (a) => { a.mintInfo.isToken2022 = true; },
  'liquidità': (a) => { a.market.liquidityUsd = 5000; },
  'mcap alto': (a) => { a.market.mcapUsd = 1e9; },
  'pool nuova': (a) => { a.market.pairAgeMin = 3; },
  'honeypot': (a) => { a.roundTripLossPct = null; },
  'tassa': (a) => { a.roundTripLossPct = 25; },
  'impact': (a) => { a.priceImpactPct = 9; },
  'già dentro': (a) => { a.state.positions.M = { costSol: 0.05 }; },
  'budget': (a) => { for (let i = 0; i < 4; i++) a.state.positions['P' + i] = { costSol: 0.12 }; },
  'troppe posizioni': (a) => { for (let i = 0; i < 5; i++) a.state.positions['P' + i] = { costSol: 0.01 }; },
  'wallet vuoto': (a) => { a.walletSol = 0.05; },
  'cooldown': (a) => { a.state.cooldowns.M = now - 10 * 60_000; },
  'perdita giornaliera': (a) => { a.state.closed.push({ closedAt: now - 1000, pnlSol: -0.2 }); },
  'nessun mercato': (a) => { a.market = null; },
};
for (const [name, mut] of Object.entries(cases)) {
  test(`scarta: ${name}`, () => { const a = base(); mut(a); assert.equal(checkEntry(a).ok, false, name); });
}

const pos = (o = {}) => ({ costSol: 0.05, peakValueSol: 0.05, openedAt: now - 60_000, whaleExited: false, ...o });
test('tiene sotto lo stop', () => assert.equal(checkExit(pos(), 0.047, cfg, now).exit, false));
test('stop loss -8%', () => assert.match(checkExit(pos(), 0.046, cfg, now).reason, /stop loss/));
test('take profit', () => assert.match(checkExit(pos(), 0.081, cfg, now).reason, /take profit/));
test('trailing stop', () => assert.match(checkExit(pos({ peakValueSol: 0.07 }), 0.0635, cfg, now).reason, /trailing/));
test('trailing non attivo sotto soglia', () => assert.equal(checkExit(pos({ peakValueSol: 0.06 }), 0.054, cfg, now).exit, false));
test('whale uscita', () => assert.match(checkExit(pos({ whaleExited: true }), 0.06, cfg, now).reason, /whale/));
test('tempo massimo', () => assert.match(checkExit(pos({ openedAt: now - 5 * 3600_000 }), 0.05, cfg, now).reason, /tempo/));
