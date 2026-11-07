import { loadConfig } from './config.js';
import { Store } from './state.js';
import { Bot } from './bot.js';
import { Jupiter } from './jupiter.js';
import { getMarket } from './market.js';
import * as chain from './chain.js';
import { startServer } from './server.js';

const cfg = loadConfig();
const conn = chain.makeConnection(cfg);
const keypair = cfg.privateKey ? chain.loadKeypair(cfg.privateKey) : null;

if (cfg.live) {
  console.log('\n⚠️  MODALITÀ SOLDI VERI');
  console.log(`   wallet ${keypair.publicKey.toBase58()}`);
  console.log(`   budget ${cfg.budgetSol} SOL · ${cfg.tradeSol} SOL per trade · stop loss -${cfg.stopLossPct}%`);
  console.log('   Puoi perdere tutto il budget. Ctrl+C per fermare.\n');
} else {
  console.log('\nModalità simulazione: nessun trade reale. Metti LIVE=true nel .env per usare soldi veri.\n');
}

const store = new Store(cfg);
const bot = new Bot(cfg, store, { conn, jup: new Jupiter(cfg), keypair, chain, getMarket });

function loop(fn, sec) {
  const tick = async () => {
    if (bot.stopped) return;
    try { await fn(); } catch (e) { store.log('ERROR', e.message); }
    setTimeout(tick, sec * 1000);
  };
  tick();
}

await bot.init();
startServer(cfg, bot);
loop(() => bot.pollWhales(), cfg.pollWhalesSec);
loop(() => bot.pollPositions(), cfg.pollPositionsSec);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    bot.stopped = true;
    console.log('\nArresto: attendo eventuali operazioni in corso…');
    await bot.queue;
    store.flush();
    console.log('Stato salvato. Le posizioni aperte restano nel wallet e verranno riprese al prossimo avvio.');
    process.exit(0);
  });
}
