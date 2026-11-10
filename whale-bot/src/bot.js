import { parseSwap, SOL_MINT } from './swapParser.js';
import { checkEntry, checkExit } from './risk.js';

const LAMPORTS = 1e9;
const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);

/** Variazione netta di SOL (fee incluse) e del token, per il nostro wallet, in una tx confermata. */
export function ownResult(tx, owner, mint) {
  const keys = tx.transaction.message.accountKeys.map((k) => (k.pubkey ? k.pubkey.toString() : k.toString()));
  const i = keys.indexOf(owner);
  const solNet = i >= 0 ? (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / LAMPORTS : 0;
  const sum = (list) => (list || []).filter((b) => b.owner === owner && b.mint === mint).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const wsol = (list) => (list || []).filter((b) => b.owner === owner && b.mint === SOL_MINT).reduce((s, b) => s + Number(b.uiTokenAmount.amount), 0);
  return {
    solNet: solNet + (wsol(tx.meta.postTokenBalances) - wsol(tx.meta.preTokenBalances)) / LAMPORTS,
    tokenDelta: sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances),
  };
}

export class Bot {
  /**
   * deps: { conn, jup, keypair, chain: { getSolBalance, getTokenRaw, getMintInfo, getNewSignatures, getParsedTx }, getMarket }
   */
  constructor(cfg, store, deps) {
    this.cfg = cfg;
    this.store = store;
    this.d = deps;
    this.owner = deps.keypair ? deps.keypair.publicKey.toBase58() : null;
    this.queue = Promise.resolve(); // le operazioni sul wallet vanno una alla volta
    this.inflight = new Set();
    this.solUsd = null;
    this.walletSol = null;
    this.stopped = false;
  }

  get state() { return this.store.state; }
  get labels() { return Object.fromEntries(this.cfg.whales.map((w) => [w.address, w.label])); }

  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async init() {
    await this.pollWhales(); // al primo giro registra solo l'ultima firma di ogni whale, senza copiare il passato
    await this.refreshPrices();
    this.store.log('INFO', `avvio in modalità ${this.cfg.live ? 'SOLDI VERI' : 'simulazione'} — ${this.cfg.whales.length} wallet seguiti, budget ${this.cfg.budgetSol} SOL`);
  }

  async refreshPrices() {
    this.solUsd = (await this.d.jup.solUsd().catch(() => null)) ?? this.solUsd;
    if (this.owner) this.walletSol = await this.d.chain.getSolBalance(this.d.conn, this.owner).catch(() => this.walletSol);
  }

  // ───────────── whale ─────────────

  async pollWhales() {
    for (const w of this.cfg.whales) {
      if (this.stopped) return;
      try {
        if (this.state.lastSigs[w.address] === undefined) {
          const [latest] = await this.d.chain.getNewSignatures(this.d.conn, w.address, null, 1);
          this.state.lastSigs[w.address] = latest ? latest.signature : null;
          this.store.save();
          continue;
        }
        const sigs = await this.d.chain.getNewSignatures(this.d.conn, w.address, this.state.lastSigs[w.address]);
        // dal più vecchio al più recente; l'ultima firma avanza solo dopo averla letta,
        // così un errore dell'RPC non fa perdere trade (si riprova al giro dopo)
        for (const s of sigs.reverse()) {
          const tx = await this.d.chain.getParsedTx(this.d.conn, s.signature);
          const sw = tx && parseSwap(tx, w.address);
          this.state.lastSigs[w.address] = s.signature;
          this.store.save();
          if (sw) await this.onWhaleSwap(w, sw);
        }
      } catch (e) {
        this.store.log('ERROR', `lettura wallet ${w.label}: ${e.message}`);
      }
    }
  }

  async onWhaleSwap(whale, sw) {
    if (sw.side === 'sell') {
      const pos = this.state.positions[sw.mint];
      if (pos && pos.whale === whale.address && !pos.whaleExited) {
        pos.whaleExited = true;
        this.store.log('INFO', `${whale.label} sta vendendo`, { symbol: pos.symbol, mint: sw.mint });
      }
      return;
    }
    this.state.stats.signals++;
    if (this.inflight.has(sw.mint)) return;
    this.inflight.add(sw.mint);
    try {
      await this.considerEntry(whale, sw);
    } finally {
      this.inflight.delete(sw.mint);
    }
  }

  async considerEntry(whale, signal) {
    const { cfg } = this;
    const [market, mintInfo] = await Promise.all([
      this.d.getMarket(signal.mint).catch(() => null),
      this.d.chain.getMintInfo(this.d.conn, signal.mint).catch(() => null),
    ]);
    const symbol = market?.symbol || short(signal.mint);
    const lamports = Math.round(cfg.tradeSol * LAMPORTS);

    let quote = null, roundTripLossPct = null, priceImpactPct = 0;
    if (mintInfo && market) {
      quote = await this.d.jup.quote(SOL_MINT, signal.mint, lamports).catch(() => null);
      if (quote) {
        priceImpactPct = Number(quote.priceImpactPct || 0) * 100;
        const back = await this.d.jup.quote(signal.mint, SOL_MINT, quote.outAmount).catch(() => null);
        if (back) roundTripLossPct = (1 - Number(back.outAmount) / lamports) * 100;
      }
    }

    const verdict = !quote && mintInfo && market
      ? { ok: false, reason: 'nessuna route su Jupiter' }
      : checkEntry({ signal, market, mintInfo, roundTripLossPct, priceImpactPct, state: this.state, cfg, walletSol: this.walletSol, solUsd: this.solUsd });

    const whaleSize = signal.quote === 'SOL' ? `${signal.quoteAmount.toFixed(2)} SOL` : `$${Math.round(signal.quoteAmount)}`;
    if (!verdict.ok) {
      this.state.stats.skipped++;
      this.store.log('SKIP', `${whale.label} ha comprato ${whaleSize} — ${verdict.reason}`, { symbol, mint: signal.mint });
      return;
    }
    await this.serial(() => this.buy(whale, signal, market, mintInfo, quote, `${whale.label} ha comprato ${whaleSize}`));
  }

  async buy(whale, signal, market, mintInfo, quote, why) {
    const { cfg } = this;
    if (this.state.positions[signal.mint]) return;
    let costSol = cfg.tradeSol, tokenRaw = BigInt(quote.outAmount), sig = 'simulazione';

    if (cfg.live) {
      try {
        sig = await this.d.jup.execute(this.d.conn, this.d.keypair, quote);
      } catch (e) {
        this.store.log('ERROR', `acquisto fallito: ${e.message}`, { symbol: market.symbol, mint: signal.mint });
        return;
      }
      const tx = await this.d.chain.getParsedTx(this.d.conn, sig);
      const res = tx ? ownResult(tx, this.owner, signal.mint) : null;
      if (res && res.tokenDelta > 0n) {
        tokenRaw = res.tokenDelta;
        costSol = -res.solNet;
      } else {
        tokenRaw = await this.d.chain.getTokenRaw(this.d.conn, this.owner, signal.mint);
      }
      await this.refreshPrices();
    }

    this.state.positions[signal.mint] = {
      mint: signal.mint,
      symbol: market.symbol,
      image: market.image,
      decimals: mintInfo.decimals,
      whale: whale.address,
      whaleLabel: whale.label,
      openedAt: Date.now(),
      costSol,
      tokenRaw: tokenRaw.toString(),
      mcapAtEntry: market.mcapUsd,
      peakValueSol: costSol,
      lastValueSol: costSol,
      whaleExited: false,
      forceExit: false,
      sellFails: 0,
      entrySig: sig,
    };
    this.state.cooldowns[signal.mint] = Date.now();
    this.store.log('BUY', `${why} — speso ${costSol.toFixed(4)} SOL`, { symbol: market.symbol, mint: signal.mint, sol: -costSol, sig });
  }

  // ───────────── posizioni ─────────────

  async pollPositions() {
    await this.refreshPrices();
    for (const pos of Object.values(this.state.positions)) {
      if (this.stopped) return;
      try {
        const q = await this.d.jup.quote(pos.mint, SOL_MINT, pos.tokenRaw).catch(() => null);
        if (!q) {
          pos.noRoute = (pos.noRoute || 0) + 1;
          if (pos.noRoute === 3) this.store.log('ERROR', 'nessuna route per vendere (liquidità sparita?)', { symbol: pos.symbol, mint: pos.mint });
          continue;
        }
        pos.noRoute = 0;
        const valueSol = Number(q.outAmount) / LAMPORTS;
        pos.lastValueSol = valueSol;
        pos.peakValueSol = Math.max(pos.peakValueSol, valueSol);

        const v = pos.forceExit ? { exit: true, reason: 'vendita manuale' } : checkExit(pos, valueSol, this.cfg);
        if (v.exit) await this.serial(() => this.sell(pos, v.reason, q));
      } catch (e) {
        this.store.log('ERROR', `controllo posizione: ${e.message}`, { symbol: pos.symbol, mint: pos.mint });
      }
    }
    this.store.pushEquity(this.equitySol());
  }

  async sell(pos, reason, quote) {
    const { cfg } = this;
    if (!this.state.positions[pos.mint]) return;
    let proceedsSol = Number(quote.outAmount) / LAMPORTS, sig = 'simulazione';

    if (cfg.live) {
      try {
        const held = await this.d.chain.getTokenRaw(this.d.conn, this.owner, pos.mint);
        if (held === 0n) throw new Error('nessun token nel wallet');
        const amount = held < BigInt(pos.tokenRaw) ? held : BigInt(pos.tokenRaw);
        // a ogni tentativo fallito alza lo slippage (max 15%) per riuscire comunque a uscire
        const slip = Math.min(cfg.slippageBps * 2 ** pos.sellFails, 1500);
        const q = await this.d.jup.quote(pos.mint, SOL_MINT, amount, slip);
        if (!q) throw new Error('nessuna route');
        sig = await this.d.jup.execute(this.d.conn, this.d.keypair, q);
        const tx = await this.d.chain.getParsedTx(this.d.conn, sig);
        proceedsSol = tx ? ownResult(tx, this.owner, pos.mint).solNet : Number(q.outAmount) / LAMPORTS;
      } catch (e) {
        pos.sellFails++;
        this.store.log('ERROR', `vendita fallita (${reason}), riprovo: ${e.message}`, { symbol: pos.symbol, mint: pos.mint });
        return;
      }
      await this.refreshPrices();
    }

    const pnlSol = proceedsSol - pos.costSol;
    const trade = {
      mint: pos.mint, symbol: pos.symbol, image: pos.image, whaleLabel: pos.whaleLabel,
      openedAt: pos.openedAt, closedAt: Date.now(),
      costSol: pos.costSol, proceedsSol, pnlSol, pnlPct: (proceedsSol / pos.costSol - 1) * 100,
      reason, entrySig: pos.entrySig, exitSig: sig,
    };
    this.state.closed.push(trade);
    delete this.state.positions[pos.mint];
    this.state.cooldowns[pos.mint] = Date.now();
    this.store.log('SELL', `${reason} — ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL`, { symbol: pos.symbol, mint: pos.mint, sol: pnlSol, sig });
  }

  // ───────────── comandi dalla dashboard ─────────────

  pause(v) { this.state.paused = v; this.store.log('INFO', v ? 'nuovi acquisti in pausa' : 'acquisti riattivati'); }
  sellAll() {
    for (const p of Object.values(this.state.positions)) p.forceExit = true;
    this.store.log('INFO', 'vendita di tutte le posizioni richiesta');
  }
  sellOne(mint) {
    const p = this.state.positions[mint];
    if (p) { p.forceExit = true; this.store.log('INFO', 'vendita manuale richiesta', { symbol: p.symbol, mint }); }
  }

  realizedSol() { return this.state.closed.reduce((s, t) => s + t.pnlSol, 0); }
  equitySol() {
    const unreal = Object.values(this.state.positions).reduce((s, p) => s + (p.lastValueSol - p.costSol), 0);
    return this.state.budgetSol + this.realizedSol() + unreal;
  }

  snapshot() {
    const s = this.state;
    const wins = s.closed.filter((t) => t.pnlSol > 0).length;
    const best = s.closed.reduce((a, t) => (!a || t.pnlSol > a.pnlSol ? t : a), null);
    const worst = s.closed.reduce((a, t) => (!a || t.pnlSol < a.pnlSol ? t : a), null);
    return {
      mode: s.mode, paused: s.paused, startedAt: s.startedAt, now: Date.now(),
      wallet: this.owner, walletSol: this.walletSol, solUsd: this.solUsd,
      budgetSol: s.budgetSol, equitySol: this.equitySol(), realizedSol: this.realizedSol(),
      trades: s.closed.length, wins, losses: s.closed.length - wins,
      best, worst, stats: s.stats,
      whales: this.cfg.whales,
      positions: Object.values(s.positions).sort((a, b) => (b.lastValueSol - b.costSol) - (a.lastValueSol - a.costSol)),
      closed: s.closed.slice(-50).reverse(),
      decisions: s.decisions.slice(-80).reverse(),
      equity: s.equity,
      rules: {
        stopLossPct: this.cfg.stopLossPct, takeProfitPct: this.cfg.takeProfitPct,
        trailingActivatePct: this.cfg.trailingActivatePct, trailingStopPct: this.cfg.trailingStopPct,
        tradeSol: this.cfg.tradeSol, maxOpenPositions: this.cfg.maxOpenPositions, maxDailyLossSol: this.cfg.maxDailyLossSol,
      },
    };
  }
}
