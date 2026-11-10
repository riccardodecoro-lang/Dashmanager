import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSwap, USDC_MINT } from '../src/swapParser.js';
import { fakeSwapTx, WHALE, MINT } from './helpers.js';

test('acquisto con SOL (fee esclusa dalla dimensione)', () => {
  const r = parseSwap(fakeSwapTx({ solChange: -2.5, tokenChange: 50000 }), WHALE);
  assert.equal(r.side, 'buy'); assert.equal(r.mint, MINT); assert.equal(r.quote, 'SOL');
  assert.ok(Math.abs(r.quoteAmount - 2.5) < 1e-9);
  assert.equal(r.tokenAmount, 50000);
});

test('vendita per SOL', () => {
  const r = parseSwap(fakeSwapTx({ solChange: 3, tokenChange: -400 }), WHALE);
  assert.equal(r.side, 'sell'); assert.ok(Math.abs(r.quoteAmount - 3) < 1e-9);
});

test('acquisto pagato in WSOL', () => {
  const r = parseSwap(fakeSwapTx({ solChange: 0, wsol: -1.2, tokenChange: 10 }), WHALE);
  assert.equal(r.side, 'buy'); assert.ok(Math.abs(r.quoteAmount - 1.2) < 1e-9);
});

test('wallet non fee payer', () => {
  const r = parseSwap(fakeSwapTx({ solChange: -1, tokenChange: 5, feePayer: false }), WHALE);
  assert.equal(r.side, 'buy'); assert.ok(Math.abs(r.quoteAmount - 1) < 1e-9);
});

test('acquisto con USDC', () => {
  const tx = fakeSwapTx({ solChange: 0, tokenChange: 77 });
  tx.meta.preTokenBalances.push({ owner: WHALE, mint: USDC_MINT, uiTokenAmount: { uiAmountString: '500', decimals: 6 } });
  tx.meta.postTokenBalances.push({ owner: WHALE, mint: USDC_MINT, uiTokenAmount: { uiAmountString: '100', decimals: 6 } });
  const r = parseSwap(tx, WHALE);
  assert.equal(r.quote, 'USD'); assert.equal(r.quoteAmount, 400); assert.equal(r.side, 'buy');
});

test('trasferimento senza SOL: ignorato', () => {
  assert.equal(parseSwap(fakeSwapTx({ solChange: 0, tokenChange: 100 }), WHALE), null);
});

test('tx fallita o wallet assente: ignorata', () => {
  const tx = fakeSwapTx({ solChange: -1, tokenChange: 5 });
  tx.meta.err = { InstructionError: [0, 'x'] };
  assert.equal(parseSwap(tx, WHALE), null);
  assert.equal(parseSwap(fakeSwapTx({ solChange: -1, tokenChange: 5 }), 'Altro'), null);
});
