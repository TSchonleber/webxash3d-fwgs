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
import { DEV_BYPASS, RPC_URL } from "../lib/config";
import { useAuth } from "../lib/auth";

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
  return (
    <Shell>
      <p className="wallet-addr mono">{walletAddress}</p>
      <p className="lock-note">Wallet actions are available in the live app.</p>
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

  const [balance, setBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const lamports = await conn.getBalance(new PublicKey(address));
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch {
      /* leave previous balance */
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

      <label className="wallet-label">Your deposit address</label>
      <div className="wallet-addr-row">
        <span className="wallet-addr mono">{address}</span>
        <button className="btn ghost wallet-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>

      <div className="wallet-actions">
        <button className="btn ghost" onClick={() => fundWallet({ address })}>Fund</button>
        <button className="btn ghost" onClick={() => exportWallet({ address })}>Export to Phantom</button>
      </div>

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
