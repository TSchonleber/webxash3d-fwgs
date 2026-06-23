import { useEffect, useState } from "react";
import { msToNextDailyPayout, API_BASE, DAY_MS } from "../lib/config";
import { splitClock } from "../lib/format";
import { RewardApi, type PoolInfo } from "../lib/api";

interface Props {
  contenders: number;
  /** kept for back-compat; the figure now reads the live on-chain vault */
  poolLamports?: string;
}

const api = new RewardApi(API_BASE);

export function PrizePool({ contenders }: Props) {
  const [remaining, setRemaining] = useState(() => msToNextDailyPayout());
  const [pool, setPool] = useState<PoolInfo | null>(null);

  useEffect(() => {
    const id = setInterval(() => setRemaining(msToNextDailyPayout()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => api.pool().then((p) => alive && setPool(p)).catch(() => {});
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const { hh, mm, ss } = splitClock(remaining);
  const pct = Math.max(0, Math.min(100, ((DAY_MS - remaining) / DAY_MS) * 100));
  const sol = pool ? pool.sol.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—";
  const vault = pool?.vaultAddress;

  return (
    <section className="hero">
      <div className="prize">
        <p className="eyebrow">Live Prize Pool · Today</p>
        <h1 className="prize-figure mono">
          {sol}
          <span className="unit">SOL</span>
        </h1>
        <p className="prize-sub">
          Paid in <b>SOL</b> to the daily <b>Top 10</b> from the on-chain vault
          {vault ? <> (<span className="mono">{vault.slice(0, 4)}…{vault.slice(-4)}</span>)</> : null}.{" "}
          <b>{contenders}</b> contender{contenders === 1 ? "" : "s"} today.
        </p>
      </div>

      <div className="countdown">
        <p className="eyebrow">Settlement In</p>
        <div className="clock mono">
          <span className="seg">{hh}</span>
          <span className="sep">:</span>
          <span className="seg">{mm}</span>
          <span className="sep">:</span>
          <span className="seg">{ss}</span>
        </div>
        <div className="meta">NEXT PAYOUT · DAILY</div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      </div>
    </section>
  );
}
