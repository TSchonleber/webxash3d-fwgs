export interface RankedEntry { wallet: string; points: number; matches: number; rank: number; }
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
