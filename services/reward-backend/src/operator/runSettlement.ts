export interface AdminSettlement {
  periodId: number;
  rootHex: string;
  total: string;
  awards: { index: number; wallet: string; amount: string; proofHex: string[] }[];
}

export interface SettlementDeps {
  settle(hour: number): Promise<{ winners: number; total: string }>;
  fetchSettlement(hour: number): Promise<AdminSettlement>;
  publish(periodId: number, rootHex: string, total: string): Promise<string>;
}

export interface SettlementSummary {
  periodId: number; winners: number; total: string; signature: string | null;
}

export async function runSettlement(hour: number, deps: SettlementDeps): Promise<SettlementSummary> {
  await deps.settle(hour);
  const s = await deps.fetchSettlement(hour);
  if (s.awards.length === 0) {
    return { periodId: s.periodId, winners: 0, total: s.total, signature: null };
  }
  const signature = await deps.publish(s.periodId, s.rootHex, s.total);
  return { periodId: s.periodId, winners: s.awards.length, total: s.total, signature };
}
