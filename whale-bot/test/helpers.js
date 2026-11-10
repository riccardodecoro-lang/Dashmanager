import { SOL_MINT } from '../src/swapParser.js';
export const WHALE = 'Wha1eWa11et1111111111111111111111111111111';
export const ME = 'MyWa11et11111111111111111111111111111111111';
export const MINT = 'MemeMint111111111111111111111111111111111111';

const bal = (owner, mint, ui, decimals = 6) => ({
  owner, mint, uiTokenAmount: { uiAmountString: String(ui), amount: String(Math.round(ui * 10 ** decimals)), decimals },
});

/** Transazione jsonParsed finta: wallet scambia SOL (lamport) contro token. */
export function fakeSwapTx({ wallet = WHALE, solChange, tokenChange, mint = MINT, fee = 5000, wsol = 0, blockTime = Math.floor(Date.now() / 1000), sig = 'sig1', feePayer = true }) {
  const pre = 10e9, post = pre + Math.round(solChange * 1e9) - (feePayer ? fee : 0);
  const keys = feePayer ? [{ pubkey: wallet }, { pubkey: 'Other' }] : [{ pubkey: 'Payer' }, { pubkey: wallet }];
  const i = feePayer ? 0 : 1;
  const preB = [0, 0], postB = [0, 0];
  preB[i] = pre; postB[i] = post;
  const preT = [bal(wallet, mint, 1000)], postT = [bal(wallet, mint, 1000 + tokenChange)];
  if (wsol) { preT.push(bal(wallet, SOL_MINT, 5, 9)); postT.push(bal(wallet, SOL_MINT, 5 + wsol, 9)); }
  return {
    blockTime,
    transaction: { signatures: [sig], message: { accountKeys: keys } },
    meta: { err: null, fee, preBalances: preB, postBalances: postB, preTokenBalances: preT, postTokenBalances: postT },
  };
}
