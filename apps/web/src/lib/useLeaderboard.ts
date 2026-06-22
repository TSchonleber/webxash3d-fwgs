import { useEffect, useState } from "react";
import { useApp } from "./context";
import { currentUtcHour } from "./config";
import type { RankedEntry } from "./api";

interface State {
  entries: RankedEntry[];
  loading: boolean;
  hour: number;
}

/** Polls the leaderboard for the current UTC hour every `intervalMs`. */
export function useLeaderboard(intervalMs = 10_000): State {
  const { api } = useApp();
  const [entries, setEntries] = useState<RankedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const hour = currentUtcHour();

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const board = await api.leaderboard(currentUtcHour());
        if (alive) setEntries(board);
      } catch {
        /* leave last-known board on transient error */
      } finally {
        if (alive) setLoading(false);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [api, intervalMs]);

  return { entries, loading, hour };
}
