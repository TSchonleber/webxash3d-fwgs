import type { MatchPlayer } from "./types";

export interface Screen { suspicious: boolean; reasons: string[]; }

export function screenPlayer(p: MatchPlayer): Screen {
  const reasons: string[] = [];
  if (p.shotsFired > 0 && p.shotsHit / p.shotsFired > 0.95) reasons.push("accuracy");
  if (p.kills >= 5 && p.headshots / p.kills > 0.9) reasons.push("headshot_ratio");
  if (p.avgReactionMs < 80) reasons.push("reaction");
  if (p.kills > 60) reasons.push("kills");
  return { suspicious: reasons.length > 0, reasons };
}
