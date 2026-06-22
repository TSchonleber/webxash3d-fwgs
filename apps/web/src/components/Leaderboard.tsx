import type { RankedEntry } from "../lib/api";
import { shortWallet } from "../lib/format";

interface Props {
  entries: RankedEntry[];
  loading: boolean;
  hour: number;
  me: string | null;
}

export function Leaderboard({ entries, loading, hour, me }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Live <span className="accent">Leaderboard</span></h2>
        <span className="hint">ROUND #{hour} · REFRESH 10s</span>
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          {loading ? (
            <><span className="spin" />Pulling live standings…</>
          ) : (
            <>No frags logged this round yet — be the first on the board.</>
          )}
        </div>
      ) : (
        <table className="lb">
          <thead>
            <tr>
              <th style={{ width: 64 }}>Rank</th>
              <th>Player</th>
              <th className="num">Points</th>
              <th className="num">Matches</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const mine = me != null && e.wallet === me;
              const rankClass = e.rank <= 3 ? `rank r${e.rank}` : "rank";
              return (
                <tr key={e.wallet} className={mine ? "me" : undefined}>
                  <td><span className={rankClass}>{e.rank}</span></td>
                  <td className="wallet">
                    {shortWallet(e.wallet)}
                    {mine && <span className="dim"> · you</span>}
                  </td>
                  <td className="num points">{e.points.toLocaleString("en-US")}</td>
                  <td className="num dim">{e.matches}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
