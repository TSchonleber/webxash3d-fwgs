import { useEffect, useState } from "react";
import { API_BASE } from "./config";
import type { DailyEntry } from "./api";

/**
 * Polls the daily Top-10 skill leaderboard (kills/wins/streaks/accuracy − deaths).
 * Shared by the marketing home and the logged-in dashboard so both render the
 * same board that actually pays out.
 */
export function useDailyBoard(intervalMs = 10_000): { board: DailyEntry[]; loading: boolean } {
  const [board, setBoard] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    const tick = () =>
      fetch(`${API_BASE}/leaderboard/daily`)
        .then((r) => r.json())
        .then((d) => {
          if (on) {
            setBoard(Array.isArray(d) ? d : []);
            setLoading(false);
          }
        })
        .catch(() => {
          if (on) setLoading(false);
        });
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return { board, loading };
}
