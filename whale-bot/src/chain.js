import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PQnoLDmNWuR9tF';

export function makeConnection(cfg) {
  return new Connection(cfg.rpcUrl, { commitment: 'confirmed' });
}

export function loadKeypair(secret) {
  const s = secret.trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  return Keypair.fromSecretKey(bs58.decode(s));
}

export async function getSolBalance(conn, owner) {
  return (await conn.getBalance(new PublicKey(owner))) / 1e9;
}

/** Saldo grezzo (BigInt) di un token posseduto da owner, sommando tutti i suoi token account. */
export async function getTokenRaw(conn, owner, mint) {
  // Con il filtro per mint l'RPC trova da solo il programma giusto (Token o Token-2022).
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  let total = 0n;
  for (const a of res.value) total += BigInt(a.account.data.parsed.info.tokenAmount.amount);
  return total;
}

/** Legge mint authority, freeze authority e programma del token. */
export async function getMintInfo(conn, mint) {
  const res = await conn.getParsedAccountInfo(new PublicKey(mint));
  const v = res.value;
  if (!v || !v.data || !v.data.parsed || v.data.parsed.type !== 'mint') return null;
  const info = v.data.parsed.info;
  return {
    decimals: info.decimals,
    mintAuthority: info.mintAuthority || null,
    freezeAuthority: info.freezeAuthority || null,
    isToken2022: v.owner.toBase58() === TOKEN_2022,
  };
}

export async function getNewSignatures(conn, address, untilSig, limit = 25) {
  const opts = { limit };
  if (untilSig) opts.until = untilSig;
  const sigs = await conn.getSignaturesForAddress(new PublicKey(address), opts);
  return sigs.filter((s) => !s.err); // dal più recente al più vecchio
}

export async function getParsedTx(conn, signature, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 1, commitment: 'confirmed' });
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
