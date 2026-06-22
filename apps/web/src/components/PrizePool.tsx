import { useEffect, useState } from "react";
import { msToNextHour } from "../lib/config";
import { formatTokenAmount, splitClock } from "../lib/format";

interface Props {
  /** Current pool size, in base units (lamports), as a decimal string. */
  poolLamports: string;
  /** Number of contenders this hour (for the subline). */
  contenders: number;
}

export function PrizePool({ poolLamports, contenders }: Props) {
  const [remaining, setRemaining] = useState(() => msToNextHour());

  useEffect(() => {
    const id = setInterval(() => setRemaining(msToNextHour()), 1000);
    return () => clearInterval(id);
  }, []);

  const { hh, mm, ss } = splitClock(remaining);
  const elapsed = 3_600_000 - remaining;
  const pct = Math.min(100, (elapsed / 3_600_000) * 100);

  return (
    <section className="hero">
      <div className="prize">
        <p className="eyebrow">Live Prize Pool · This Hour</p>
        <h1 className="prize-figure mono">
          {formatTokenAmount(poolLamports)}
          <span className="unit">$TOKEN</span>
        </h1>
        <p className="prize-sub">
          Settled every hour on the hour. Frag, top the board, and your share is
          merkle-distributed to <b>{contenders}</b> eligible contender{contenders === 1 ? "" : "s"}.
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
        <div className="meta">NEXT SETTLEMENT @ TOP OF THE UTC HOUR</div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      </div>
    </section>
  );
}
