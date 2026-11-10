// Regole del risk manager. Funzioni pure, testate in test/risk.test.js.

/** Decide se copiare l'acquisto di una whale. Ritorna { ok, reason }. */
export function checkEntry({ signal, market, mintInfo, roundTripLossPct, priceImpactPct, state, cfg, walletSol, solUsd, now = Date.now() }) {
  const fail = (reason) => ({ ok: false, reason });

  if (state.paused) return fail('bot in pausa');
  if (dailyRealized(state, now) <= -cfg.maxDailyLossSol) return fail('limite di perdita giornaliera raggiunto');

  const ageSec = signal.blockTime ? now / 1000 - signal.blockTime : 0;
  if (ageSec > cfg.maxSignalAgeSec) return fail(`segnale vecchio (${Math.round(ageSec)}s)`);

  const whaleSol = signal.quote === 'SOL' ? signal.quoteAmount : solUsd ? signal.quoteAmount / solUsd : 0;
  if (whaleSol < cfg.minWhaleBuySol) return fail(`acquisto whale piccolo (${whaleSol.toFixed(2)} SOL)`);

  const open = Object.values(state.positions);
  if (state.positions[signal.mint]) return fail('già in posizione');
  if (open.length >= cfg.maxOpenPositions) return fail('troppe posizioni aperte');
  const exposure = open.reduce((s, p) => s + p.costSol, 0);
  if (exposure + cfg.tradeSol > cfg.budgetSol + 1e-9) return fail('budget esaurito');
  if (walletSol !== null && walletSol < cfg.tradeSol + cfg.reserveSol) return fail('SOL insufficienti nel wallet');

  const last = state.cooldowns[signal.mint];
  if (last && now - last < cfg.cooldownMin * 60_000) return fail('token in cooldown');

  if (!mintInfo) return fail('mint non leggibile');
  if (mintInfo.isToken2022 && !cfg.allowToken2022) return fail('token-2022 non ammesso');
  if (mintInfo.mintAuthority) return fail('mint authority attiva (possono stampare token)');
  if (mintInfo.freezeAuthority) return fail('freeze authority attiva (possono bloccarti i token)');

  if (!market) return fail('nessun mercato trovato');
  if (market.liquidityUsd < cfg.minLiquidityUsd) return fail(`liquidità bassa ($${Math.round(market.liquidityUsd)})`);
  if (market.mcapUsd < cfg.minMcapUsd || market.mcapUsd > cfg.maxMcapUsd) return fail(`market cap fuori range ($${Math.round(market.mcapUsd)})`);
  if (market.pairAgeMin !== null && market.pairAgeMin < cfg.minPairAgeMin) return fail(`pool troppo nuova (${Math.round(market.pairAgeMin)} min)`);

  if (priceImpactPct > cfg.maxPriceImpactPct) return fail(`price impact alto (${priceImpactPct.toFixed(1)}%)`);
  if (roundTripLossPct === null) return fail('impossibile rivendere (possibile honeypot)');
  if (roundTripLossPct > cfg.maxRoundTripLossPct) return fail(`perdita andata/ritorno ${roundTripLossPct.toFixed(1)}% (tasse o honeypot)`);

  return { ok: true, reason: 'tutti i controlli superati' };
}

/** Decide se chiudere una posizione. valueSol = SOL ottenibili vendendo tutto ora. */
export function checkExit(pos, valueSol, cfg, now = Date.now()) {
  const pnlPct = (valueSol / pos.costSol - 1) * 100;
  const peakPct = (Math.max(pos.peakValueSol, valueSol) / pos.costSol - 1) * 100;

  if (pos.whaleExited && cfg.followWhaleExit) return { exit: true, reason: 'la whale ha venduto' };
  if (pnlPct <= -cfg.stopLossPct) return { exit: true, reason: `stop loss (${pnlPct.toFixed(1)}%)` };
  if (cfg.takeProfitPct > 0 && pnlPct >= cfg.takeProfitPct) return { exit: true, reason: `take profit (+${pnlPct.toFixed(1)}%)` };
  if (peakPct >= cfg.trailingActivatePct && peakPct - pnlPct >= cfg.trailingStopPct) {
    return { exit: true, reason: `trailing stop (picco +${peakPct.toFixed(1)}%, ora ${pnlPct.toFixed(1)}%)` };
  }
  if (cfg.maxHoldMin > 0 && now - pos.openedAt >= cfg.maxHoldMin * 60_000) return { exit: true, reason: 'tempo massimo di tenuta' };
  return { exit: false, pnlPct };
}

export function dailyRealized(state, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  return state.closed.filter((t) => t.closedAt >= start.getTime()).reduce((s, t) => s + t.pnlSol, 0);
}
