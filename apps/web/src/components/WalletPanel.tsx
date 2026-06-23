import { useState, useEffect, useCallback } from "react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  useWallets,
  useFundWallet,
  useExportWallet,
  useSignAndSendTransaction,
} from "@privy-io/react-auth/solana";
import { DEV_BYPASS, RPC_URL, TOKEN_MINT, TOKEN_SYMBOL } from "../lib/config";
import { useAuth } from "../lib/auth";
import { SwapBox } from "./SwapBox";

/**
 * Self-custody panel for the Privy embedded Solana wallet:
 *  - Receive  : show + copy the deposit address
 *  - Fund     : Privy fiat on-ramp / transfer
 *  - Withdraw : sign+send a SOL transfer from the embedded wallet
 *  - Export   : reveal the private key to import into Phantom (full custody)
 *
 * Privy hooks require the PrivyProvider, which is only mounted when DEV_BYPASS
 * is off — so the bypass build renders a static stub instead.
 */
export function WalletPanel() {
  return DEV_BYPASS ? <WalletPanelStub /> : <PrivyWalletPanel />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Your <span className="accent">Wallet</span></h2>
        <span className="hint">SOLANA · NON-CUSTODIAL</span>
      </div>
      {children}
    </div>
  );
}

function WalletPanelStub() {
  const { walletAddress } = useAuth();
  // Demo build (DEV_BYPASS) can't mount Privy, so mirror the live panel's
  // balance readout with sample figures — the real panel reads these live.
  return (
    <Shell>
      <div className="wallet-bal">
        <span className="wallet-bal-num mono">2.41</span>
        <span className="wallet-bal-unit">SOL</span>
      </div>
      <div className="wallet-token mono">
        <span className="wallet-token-amt">12,500</span>
        <span className="wallet-token-sym">{TOKEN_SYMBOL}</span>
      </div>

      <label className="wallet-label">Your deposit address</label>
      <div className="wallet-addr-row">
        <span className="wallet-addr mono">{walletAddress}</span>
        <button className="btn ghost wallet-copy" disabled>Copy</button>
      </div>

      <div className="wallet-actions">
        <button className="btn ghost" disabled>Fund</button>
        <button className="btn ghost" disabled>Export key</button>
      </div>

      <div className="swap swap--soon">
        <label className="wallet-label">Swap to {TOKEN_SYMBOL}</label>
        <div className="swap-row">
          <input className="wallet-input mono" placeholder="0.0" disabled />
          <span className="swap-unit">SOL</span>
          <button className="btn" disabled>Swap</button>
        </div>
      </div>

      <p className="lock-note">Demo wallet — live SOL and {TOKEN_SYMBOL} balances, deposits, swaps and withdrawals are active once you sign in.</p>
    </Shell>
  );
}

function PrivyWalletPanel() {
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const address = wallet?.address ?? null;

  const { fundWallet } = useFundWallet();
  const { exportWallet } = useExportWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Export (reveal private key) only works for Privy embedded wallets — Privy
  // never holds the key for a connected external wallet (Phantom/Solflare).
  const w = wallet as { walletClientType?: string; connectorType?: string } | undefined;
  const isEmbedded = w?.walletClientType === "privy" || w?.connectorType === "embedded";

  const [balance, setBalance] = useState<number | null>(null);
  const [tokenBal, setTokenBal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    const conn = new Connection(RPC_URL, "confirmed");
    const owner = new PublicKey(address);
    try {
      const lamports = await conn.getBalance(owner);
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch {
      /* leave previous SOL balance */
    }
    if (TOKEN_MINT) {
      try {
        const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(TOKEN_MINT) });
        let total = 0;
        for (const { account } of res.value) {
          const amt = account.data.parsed?.info?.tokenAmount?.uiAmount;
          if (typeof amt === "number") total += amt;
        }
        setTokenBal(total);
      } catch {
        /* leave previous token balance */
      }
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!wallet || !address) {
    return (
      <Shell>
        <p className="lock-note">
          No embedded wallet yet — log in with <b>email</b> to create one.
          Connecting an external wallet (Phantom, etc.) uses that wallet instead.
        </p>
      </Shell>
    );
  }

  const copy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const withdraw = async () => {
    setMsg(null);
    let toPk: PublicKey;
    try {
      toPk = new PublicKey(to.trim());
    } catch {
      setMsg("Invalid recipient address.");
      return;
    }
    const sol = Number(amount);
    if (!(sol > 0)) {
      setMsg("Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const { blockhash } = await conn.getLatestBlockhash();
      const tx = new Transaction({
        feePayer: new PublicKey(address),
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(address),
          toPubkey: toPk,
          lamports: Math.round(sol * LAMPORTS_PER_SOL),
        }),
      );
      const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      await signAndSendTransaction({ transaction: new Uint8Array(serialized), wallet });
      setMsg(`Sent ${sol} SOL ✓`);
      setTo("");
      setAmount("");
      setTimeout(refresh, 1500);
    } catch (e) {
      setMsg(e instanceof Error ? `Failed: ${e.message}` : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="wallet-bal">
        <span className="wallet-bal-num mono">{balance === null ? "—" : balance.toFixed(4)}</span>
        <span className="wallet-bal-unit">SOL</span>
      </div>
      <div className="wallet-token mono">
        {TOKEN_MINT ? (
          <>
            <span className="wallet-token-amt">{tokenBal === null ? "—" : tokenBal.toLocaleString()}</span>
            <span className="wallet-token-sym">{TOKEN_SYMBOL}</span>
          </>
        ) : (
          <span className="wallet-token-soon">{TOKEN_SYMBOL} · not live yet</span>
        )}
      </div>

      <label className="wallet-label">Your deposit address</label>
      <div className="wallet-addr-row">
        <span className="wallet-addr mono">{address}</span>
        <button className="btn ghost wallet-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>

      <div className="wallet-actions">
        <button className="btn ghost" onClick={() => fundWallet({ address })}>Fund</button>
        {isEmbedded && (
          <button className="btn ghost" onClick={() => exportWallet({ address })}>Export key</button>
        )}
      </div>

      {TOKEN_MINT ? (
        <SwapBox solBalance={balance} onSwapped={refresh} />
      ) : (
        <div className="swap swap--soon">
          <label className="wallet-label">Swap to {TOKEN_SYMBOL}</label>
          <p className="lock-note">One-tap SOL → {TOKEN_SYMBOL} swap unlocks when the token launches.</p>
        </div>
      )}

      <label className="wallet-label">Withdraw SOL</label>
      <div className="wallet-send">
        <input
          className="wallet-input mono"
          placeholder="recipient address"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <input
          className="wallet-input wallet-input--amt mono"
          placeholder="0.0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button className="btn" disabled={busy} onClick={withdraw}>{busy ? "Sending…" : "Send"}</button>
      </div>
      {msg && <p className="lock-note">{msg}</p>}
    </Shell>
  );
}
