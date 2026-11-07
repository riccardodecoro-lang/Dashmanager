// Dati di mercato da DexScreener (gratuito, senza chiave).

const cache = new Map();

export async function getMarket(mint, { ttlMs = 30_000 } = {}) {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const pairs = (await res.json()).filter((p) => p.baseToken?.address === mint);
  if (!pairs.length) { cache.set(mint, { at: Date.now(), value: null }); return null; }

  const best = pairs.reduce((a, b) => ((b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a));
  const value = {
    symbol: best.baseToken.symbol,
    name: best.baseToken.name,
    image: best.info?.imageUrl || null,
    priceUsd: Number(best.priceUsd || 0),
    liquidityUsd: pairs.reduce((s, p) => s + (p.liquidity?.usd || 0), 0),
    mcapUsd: Number(best.marketCap || best.fdv || 0),
    pairAgeMin: best.pairCreatedAt ? (Date.now() - best.pairCreatedAt) / 60_000 : null,
    dex: best.dexId,
    url: best.url,
  };
  cache.set(mint, { at: Date.now(), value });
  return value;
}
