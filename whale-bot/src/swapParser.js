// Riconosce acquisti e vendite di un wallet a partire da una transazione "jsonParsed".
// Funzione pura: nessuna chiamata di rete, così è testabile.

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrajaRrkGZ8T8Hu5YoG8KNyq7G3ccoDJWgDbaV1';
const STABLES = new Set([USDC_MINT, USDT_MINT]);
const LAMPORTS = 1e9;

function keyToString(k) {
  if (typeof k === 'string') return k;
  if (k && k.pubkey !== undefined) return keyToString(k.pubkey);
  if (k && typeof k.toBase58 === 'function') return k.toBase58();
  return String(k);
}

function tokenDeltas(meta, owner) {
  const out = new Map(); // mint -> { delta (ui), decimals }
  const add = (list, sign) => {
    for (const b of list || []) {
      if (b.owner !== owner) continue;
      const ui = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
      const cur = out.get(b.mint) || { delta: 0, decimals: b.uiTokenAmount?.decimals ?? 0 };
      cur.delta += sign * ui;
      out.set(b.mint, cur);
    }
  };
  add(meta.preTokenBalances, -1);
  add(meta.postTokenBalances, +1);
  return out;
}

/**
 * @returns {null | { side: 'buy'|'sell', mint, tokenAmount, quote: 'SOL'|'USD', quoteAmount, signature, blockTime }}
 * quoteAmount è in SOL (quote=SOL) o in dollari (quote=USD).
 */
export function parseSwap(tx, wallet, { dustSol = 0.001 } = {}) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const keys = tx.transaction?.message?.accountKeys || [];
  const idx = keys.findIndex((k) => keyToString(k) === wallet);
  if (idx < 0) return null;

  const fee = keyToString(keys[0]) === wallet ? (tx.meta.fee || 0) : 0;
  const lamportDelta = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx] + fee) / LAMPORTS;

  const tokens = tokenDeltas(tx.meta, wallet);
  const wsol = tokens.get(SOL_MINT)?.delta || 0;
  tokens.delete(SOL_MINT);
  const solDelta = lamportDelta + wsol;

  let stableDelta = 0;
  for (const m of STABLES) {
    if (tokens.has(m)) { stableDelta += tokens.get(m).delta; tokens.delete(m); }
  }

  const moved = [...tokens.entries()].filter(([, v]) => Math.abs(v.delta) > 0);
  if (moved.length !== 1) return null; // nessuna swap, oppure swap multi-token: ignorata
  const [mint, { delta }] = moved[0];

  let quote, quoteAmount;
  if (Math.abs(solDelta) >= dustSol && Math.sign(solDelta) === -Math.sign(delta)) {
    quote = 'SOL'; quoteAmount = Math.abs(solDelta);
  } else if (Math.abs(stableDelta) >= 1 && Math.sign(stableDelta) === -Math.sign(delta)) {
    quote = 'USD'; quoteAmount = Math.abs(stableDelta);
  } else {
    return null; // trasferimento, airdrop o swap token→token
  }

  return {
    side: delta > 0 ? 'buy' : 'sell',
    mint,
    tokenAmount: Math.abs(delta),
    quote,
    quoteAmount,
    signature: tx.transaction?.signatures?.[0],
    blockTime: tx.blockTime ?? null,
  };
}
