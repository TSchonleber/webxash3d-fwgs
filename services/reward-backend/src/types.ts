export type Team = "A" | "B";

export interface MatchPlayer {
  wallet: string;        // base58 pubkey
  team: Team;
  won: boolean;          // player's team won the match
  kills: number;
  deaths: number;
  bestStreak?: number;   // longest kills-without-dying streak in the match (oracle-populated; phase 2)
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  avgReactionMs: number; // mean ms from enemy-visible to first damage
}

export interface MatchResult {
  matchId: string;
  endedAtMs: number;     // unix ms
  players: MatchPlayer[];
}

export interface RankedEntry {
  wallet: string;
  kills: number;         // primary ranking metric — most kills wins
  deaths: number;        // tiebreaker (fewer is better) + display
  matches: number;
  rank: number;          // 1-based
}

export interface Award {
  index: number;         // 0-based position in the published set
  wallet: string;        // base58
  amount: bigint;        // lamports
}
