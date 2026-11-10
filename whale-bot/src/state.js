import fs from 'node:fs';
import path from 'node:path';

const MAX_DECISIONS = 400;
const MAX_EQUITY = 3000;

export function emptyState(cfg) {
  return {
    version: 1,
    mode: cfg.live ? 'live' : 'paper',
    startedAt: Date.now(),
    budgetSol: cfg.budgetSol,
    paused: false,
    positions: {},   // mint -> posizione aperta
    closed: [],      // trade chiusi
    decisions: [],   // registro decisioni (più recenti in fondo)
    equity: [],      // [{ t, v }] valore in SOL
    cooldowns: {},   // mint -> ultimo acquisto (ms)
    lastSigs: {},    // whale -> ultima firma vista
    stats: { signals: 0, skipped: 0 },
  };
}

export class Store {
  constructor(cfg) {
    this.file = cfg.stateFile;
    this.state = emptyState(cfg);
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.mode !== this.state.mode) throw new Error(`${this.file} appartiene alla modalità ${saved.mode}`);
      this.state = { ...this.state, ...saved, budgetSol: cfg.budgetSol };
    }
    this.timer = null;
  }

  log(kind, text, extra = {}) {
    const entry = { t: Date.now(), kind, text, ...extra };
    this.state.decisions.push(entry);
    if (this.state.decisions.length > MAX_DECISIONS) this.state.decisions.splice(0, this.state.decisions.length - MAX_DECISIONS);
    const tag = kind.padEnd(5);
    console.log(`${new Date(entry.t).toLocaleTimeString('it-IT')} ${tag} ${extra.symbol ? '$' + extra.symbol + ' ' : ''}${text}`);
    this.save();
    return entry;
  }

  pushEquity(v) {
    const eq = this.state.equity;
    const now = Date.now();
    if (eq.length && now - eq[eq.length - 1].t < 30_000) eq[eq.length - 1] = { t: now, v };
    else eq.push({ t: now, v });
    if (eq.length > MAX_EQUITY) eq.splice(0, eq.length - MAX_EQUITY);
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    fs.renameSync(tmp, this.file);
  }
}
