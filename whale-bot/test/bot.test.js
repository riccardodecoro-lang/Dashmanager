import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Bot } from '../src/bot.js';
import { Store } from '../src/state.js';
import { SOL_MINT } from '../src/swapParser.js';
import { fakeSwapTx, WHALE, ME, MINT } from './helpers.js';

function setup({ live = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  const cfg = {
    live, whales: [{ address: WHALE, label: 'whale1' }], stateFile: path.join(dir, 's.json'),
    budgetSol: 0.5, tradeSol: 0.05, maxOpenPositions: 5, reserveSol: 0.02, maxDailyLossSol: 0.15,
    minWhaleBuySol: 1, maxSignalAgeSec: 60, minLiquidityUsd: 20000, minMcapUsd: 50000, maxMcapUsd: 5e7,
    minPairAgeMin: 30, maxRoundTripLossPct: 8, allowToken2022: false, cooldownMin: 60, maxPriceImpactPct: 3,
    stopLossPct: 8, takeProfitPct: 60, trailingActivatePct: 25, trailingStopPct: 12, maxHoldMin: 240,
    followWhaleExit: true, slippageBps: 300,
  };
  // prezzo: quanti lamport vale 1 unità grezza del token
  const world = { priceLamPerRaw: 0.001, txs: {}, sigs: [], executed: [], held: 0n };
  const jup = {
    async solUsd() { return 150; },
    async quote(inM, outM, amount) {
      const a = Number(amount);
      if (inM === SOL_MINT) return { outAmount: String(Math.floor(a / world.priceLamPerRaw)), priceImpactPct: '0.004', inputMint: inM, outputMint: outM, inAmount: String(a) };
      return { outAmount: String(Math.floor(a * world.priceLamPerRaw * 0.99)), priceImpactPct: '0.004', inputMint: inM, outputMint: outM, inAmount: String(a) };
    },
    async execute(conn, kp, q) {
      const sig = 'mysig' + world.executed.length;
      world.executed.push(q);
      const buy = q.inputMint === SOL_MINT;
      const sol = buy ? -(Number(q.inAmount) / 1e9 + 0.002) : Number(q.outAmount) / 1e9;
      const tok = buy ? Number(q.outAmount) / 1e6 : -Number(q.inAmount) / 1e6;
      world.held += buy ? BigInt(q.outAmount) : -BigInt(q.inAmount);
      world.txs[sig] = fakeSwapTx({ wallet: ME, solChange: sol, tokenChange: tok, sig, fee: 0 });
      return sig;
    },
  };
  const chain = {
    async getSolBalance() { return 1; },
    async getTokenRaw() { return world.held; },
    async getMintInfo() { return { decimals: 6, mintAuthority: null, freezeAuthority: null, isToken2022: false }; },
    async getNewSignatures(c, a, until, limit) {
      if (!until && limit === 1) return [{ signature: 'old' }];
      const i = world.sigs.indexOf(until);
      return world.sigs.slice(i + 1).reverse().map((s) => ({ signature: s }));
    },
    async getParsedTx(c, s) { return world.txs[s] || null; },
  };
  const getMarket = async () => ({ symbol: 'MEME', liquidityUsd: 90000, mcapUsd: 800000, pairAgeMin: 500, image: null });
  const keypair = live ? { publicKey: { toBase58: () => ME } } : null;
  const store = new Store(cfg);
  const bot = new Bot(cfg, store, { conn: {}, jup, keypair, chain, getMarket });
  world.sigs.push('old');
  const whaleDoes = (sig, solChange, tokenChange) => { world.txs[sig] = fakeSwapTx({ solChange, tokenChange, sig }); world.sigs.push(sig); };
  return { bot, store, world, whaleDoes };
}

test('simulazione: copia acquisto e chiude con stop loss', async () => {
  const { bot, world, whaleDoes } = setup();
  await bot.init();
  whaleDoes('w1', -3, 3e3);
  await bot.pollWhales();
  const pos = bot.state.positions[MINT];
  assert.ok(pos, 'posizione aperta');
  assert.equal(pos.costSol, 0.05);
  await bot.pollPositions();
  assert.ok(bot.state.positions[MINT], 'ancora aperta (-1%)');
  world.priceLamPerRaw *= 0.9;
  await bot.pollPositions();
  assert.equal(bot.state.positions[MINT], undefined);
  assert.match(bot.state.closed[0].reason, /stop loss/);
  assert.ok(bot.state.closed[0].pnlSol < 0);
  assert.ok(bot.equitySol() < 0.5);
  bot.store.flush();
});

test('simulazione: piccola whale scartata, poi cooldown', async () => {
  const { bot, whaleDoes } = setup();
  await bot.init();
  whaleDoes('w1', -0.2, 100);
  await bot.pollWhales();
  assert.equal(Object.keys(bot.state.positions).length, 0);
  assert.equal(bot.state.decisions.at(-1).kind, 'SKIP');
  bot.store.flush();
});

test('soldi veri (mock): compra, la whale vende, il bot esce', async () => {
  const { bot, world, whaleDoes } = setup({ live: true });
  await bot.init();
  whaleDoes('w1', -5, 4e3);
  await bot.pollWhales();
  const pos = bot.state.positions[MINT];
  assert.ok(pos);
  assert.ok(Math.abs(pos.costSol - 0.052) < 1e-9, 'costo reale con fee/rent: ' + pos.costSol);
  assert.equal(BigInt(pos.tokenRaw), world.held);
  world.priceLamPerRaw *= 1.1;
  whaleDoes('w2', 4, -2e3);
  await bot.pollWhales();
  assert.equal(bot.state.positions[MINT].whaleExited, true);
  await bot.pollPositions();
  assert.equal(bot.state.positions[MINT], undefined);
  assert.equal(world.executed.length, 2);
  assert.equal(world.held, 0n);
  const t = bot.state.closed[0];
  assert.match(t.reason, /whale/);
  assert.ok(t.proceedsSol > 0.05, 'ricavo ' + t.proceedsSol);
  bot.store.flush();
});

test('vendita manuale dalla dashboard', async () => {
  const { bot, whaleDoes } = setup();
  await bot.init();
  whaleDoes('w1', -3, 3e3);
  await bot.pollWhales();
  bot.sellAll();
  await bot.pollPositions();
  assert.equal(Object.keys(bot.state.positions).length, 0);
  assert.equal(bot.state.closed[0].reason, 'vendita manuale');
  const snap = bot.snapshot();
  assert.equal(snap.trades, 1);
  bot.store.flush();
});

test('errore RPC durante la lettura: il trade non va perso', async () => {
  const { bot, whaleDoes } = setup();
  await bot.init();
  whaleDoes('w1', -3, 3e3);
  const orig = bot.d.chain.getParsedTx;
  bot.d.chain.getParsedTx = async () => { throw new Error('429 Too Many Requests'); };
  await bot.pollWhales();
  assert.equal(Object.keys(bot.state.positions).length, 0);
  assert.equal(bot.state.lastSigs[WHALE], 'old', 'firma non avanzata');
  bot.d.chain.getParsedTx = orig;
  await bot.pollWhales();
  assert.ok(bot.state.positions[MINT], 'copiato al giro successivo');
  bot.store.flush();
});
