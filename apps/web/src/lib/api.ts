export interface RankedEntry { wallet: string; kills: number; deaths: number; matches: number; rank: number; }
export interface DailyEntry {
  wallet: string; kills: number; deaths: number; kd: number;
  headshots: number; hsPct: number; accuracy: number; bestStreak: number;
  wins: number; matches: number; winPct: number; score: number; rank: number;
}
export interface ClaimData { periodId: number; index: number; amount: string; proof: string[]; }
export interface PoolInfo { vaultAddress: string | null; lamports: number; sol: number; denom: string; }

export class RewardApi {
  private base: string;
  constructor(base: string) {
    this.base = base;
  }

  async leaderboard(hour: number): Promise<RankedEntry[]> {
    const res = await fetch(`${this.base}/leaderboard/${hour}`);
    if (!res.ok) return [];
    return (await res.json()) as RankedEntry[];
  }

  /** Daily Top-10 ranked by weighted skill score. */
  async dailyLeaderboard(): Promise<DailyEntry[]> {
    const res = await fetch(`${this.base}/leaderboard/daily`);
    if (!res.ok) return [];
    return (await res.json()) as DailyEntry[];
  }

  async claim(hour: number, wallet: string): Promise<ClaimData | null> {
    const res = await fetch(`${this.base}/claim/${hour}/${wallet}`);
    if (!res.ok) return null;
    return (await res.json()) as ClaimData;
  }

  async pool(): Promise<PoolInfo> {
    const res = await fetch(`${this.base}/pool`);
    if (!res.ok) return { vaultAddress: null, lamports: 0, sol: 0, denom: "SOL" };
    return (await res.json()) as PoolInfo;
  }
}
