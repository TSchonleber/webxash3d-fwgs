import { useState, useEffect, useCallback, useRef } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { RPC_URL, TOKEN_MINT, TOKEN_SYMBOL, SOL_MINT, JUPITER_API, SWAP_SLIPPAGE_BPS } from "../lib/config";

/**
 * One-tap SOL -> game-token swap, routed through Jupiter and signed with the
 * player's existing Privy wallet (embedded or connected). Lets a player who
 * just funded with SOL turn it into the token the game uses, without leaving
 * the dashboard.
 *
 * Only mounted when TOKEN_MINT is configured — pre-launch the wallet shows a
 * "live at launch" placeholder instead.
 */
export function SwapBox({
  solBalance,
  onSwapped,
}: {
  solBalance: number | null;
  onSwapped: () => void;
}) {
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const address = wallet?.address ?? "";
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [amount, setAmount] = useState("");
  const [decimals, setDecimals] = useState<number | null>(null);
  const [outTokens, setOutTokens] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [noRoute, setNoRoute] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const quoteSeq = useRef(0);

  // Token decimals (needed to display the estimated output) — read once.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const conn = new Connection(RPC_URL, "confirmed");
        const info = await conn.getParsedAccountInfo(new PublicKey(TOKEN_MINT));
        const dec = (info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)
          ?.parsed?.info?.decimals;
        if (live && typeof dec === "number") setDecimals(dec);
      } catch {
        /* leave null — output shows as “—” until known */
      }
    })();
    return () => { live = false; };
  }, []);

  const lamportsIn = () => {
    const sol = Number(amount);
    return sol > 0 ? Math.round(sol * LAMPORTS_PER_SOL) : 0;
  };

  // Live quote (debounced) as the player types an amount.
  useEffect(() => {
    const lamports = lamportsIn();
    setNoRoute(false);
    if (!lamports) { setOutTokens(null); return; }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const url = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${TOKEN_MINT}` +
          `&amount=${lamports}&slippageBps=${SWAP_SLIPPAGE_BPS}&restrictIntermediateTokens=true`;
        const q = await fetch(url).then((r) => r.json());
        if (seq !== quoteSeq.current) return; // a newer keystroke superseded this
        if (!q || q.error || !q.outAmount) { setOutTokens(null); setNoRoute(true); }
        else if (decimals !== null) setOutTokens(Number(q.outAmount) / 10 ** decimals);
      } catch {
        if (seq === quoteSeq.current) { setOutTokens(null); setNoRoute(true); }
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [amount, decimals]);

  const setMax = useCallback(() => {
    if (solBalance === null) return;
    // leave a small buffer for network fees
    const usable = Math.max(0, solBalance - 0.02);
    setAmount(usable > 0 ? usable.toFixed(4) : "0");
  }, [solBalance]);

  const swap = async () => {
    setMsg(null);
    const lamports = lamportsIn();
    if (!lamports) { setMsg("Enter a SOL amount."); return; }
    setBusy(true);
    try {
      // fresh quote at swap time so pricing/route is current
      const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${TOKEN_MINT}` +
        `&amount=${lamports}&slippageBps=${SWAP_SLIPPAGE_BPS}&restrictIntermediateTokens=true`;
      const quote = await fetch(quoteUrl).then((r) => r.json());
      if (!quote || quote.error || !quote.outAmount) {
        setMsg("No swap route available yet."); setBusy(false); return;
      }
      const swapRes = await fetch(`${JUPITER_API}/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: address,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        }),
      }).then((r) => r.json());
      if (!swapRes?.swapTransaction) { setMsg("Could not build the swap. Try again."); setBusy(false); return; }

      // Jupiter returns a base64 (versioned) transaction; Privy signs+sends the
      // serialized bytes, same as the withdraw path.
      const txBytes = Uint8Array.from(atob(swapRes.swapTransaction), (c) => c.charCodeAt(0));
      await signAndSendTransaction({ transaction: txBytes, wallet });

      setMsg(`Swapped ${amount} SOL → ${TOKEN_SYMBOL} ✓`);
      setAmount("");
      setOutTokens(null);
      setTimeout(onSwapped, 2000);
    } catch (e) {
      setMsg(e instanceof Error ? `Swap failed: ${e.message}` : "Swap failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="swap">
      <div className="swap-head">
        <label className="wallet-label">Swap to {TOKEN_SYMBOL}</label>
        <button className="swap-max" type="button" onClick={setMax} disabled={!solBalance}>Max</button>
      </div>
      <div className="swap-row">
        <input
          className="wallet-input mono"
          placeholder="0.0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="swap-unit">SOL</span>
        <button className="btn" disabled={busy || !lamportsIn()} onClick={swap}>
          {busy ? "Swapping…" : "Swap"}
        </button>
      </div>
      <div className="swap-est mono">
        {noRoute
          ? `No route for ${TOKEN_SYMBOL} yet`
          : quoting
            ? "quoting…"
            : outTokens !== null
              ? `≈ ${outTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${TOKEN_SYMBOL}`
              : `You receive ${TOKEN_SYMBOL}`}
      </div>
      {msg && <p className="lock-note">{msg}</p>}
    </div>
  );
}
