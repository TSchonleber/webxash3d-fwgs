import type { DailyEntry } from "../lib/api";
import { shortWallet } from "../lib/format";

interface Props {
  entries: DailyEntry[];
  loading: boolean;
  me: string | null;
}

export function Leaderboard({ entries, loading, me }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Daily <span className="accent">Leaderboard</span></h2>
        <span className="hint">THIS WINDOW · TOP 10 · BY SKILL SCORE</span>
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          {loading ? (
            <><span className="spin" />Pulling this window's standings…</>
          ) : (
            <>No frags logged this window yet — be the first on the board.</>
          )}
        </div>
      ) : (
        <table className="lb">
          <thead>
            <tr>
              <th style={{ width: 64 }}>Rank</th>
              <th>Player</th>
              <th className="num">Kills</th>
              <th className="num">K/D</th>
              <th className="num">Win%</th>
              <th className="num">Score</th>
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
                  <td className="num dim">{e.kills.toLocaleString("en-US")}</td>
                  <td className="num dim">{e.kd}</td>
                  <td className="num dim">{e.winPct}%</td>
                  <td className="num points">{e.score.toLocaleString("en-US")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
