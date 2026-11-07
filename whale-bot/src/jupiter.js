import { VersionedTransaction } from '@solana/web3.js';
import { SOL_MINT, USDC_MINT } from './swapParser.js';

export class Jupiter {
  constructor(cfg) { this.cfg = cfg; this.base = cfg.jupiterUrl; }

  /** amountRaw: stringa o BigInt, in unità minime del token di input. */
  async quote(inputMint, outputMint, amountRaw, slippageBps = this.cfg.slippageBps) {
    const q = new URLSearchParams({
      inputMint, outputMint,
      amount: String(amountRaw),
      slippageBps: String(slippageBps),
      restrictIntermediateTokens: 'true',
    });
    const res = await fetch(`${this.base}/quote?${q}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 404) return null; // nessuna route
      throw new Error(`Jupiter quote HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const quote = await res.json();
    if (!quote || !quote.outAmount) return null;
    return quote;
  }

  async solUsd() {
    const q = await this.quote(SOL_MINT, USDC_MINT, 1e9, 50);
    return q ? Number(q.outAmount) / 1e6 : null;
  }

  /** Costruisce, firma e invia la swap. Ritorna la firma confermata. */
  async execute(conn, keypair, quote) {
    const res = await fetch(`${this.base}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: { maxLamports: this.cfg.priorityFeeMaxLamports, priorityLevel: 'veryHigh' },
        },
      }),
    });
    if (!res.ok) throw new Error(`Jupiter swap HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { swapTransaction, lastValidBlockHeight, simulationError } = await res.json();
    if (simulationError) throw new Error(`Jupiter prevede che la swap fallisca: ${JSON.stringify(simulationError).slice(0, 200)}`);

    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([keypair]);
    const raw = tx.serialize();
    const signature = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });

    const conf = await conn.confirmTransaction(
      { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight },
      'confirmed',
    );
    if (conf.value.err) throw new Error(`transazione fallita on-chain: ${JSON.stringify(conf.value.err)} (${signature})`);
    return signature;
  }
}
