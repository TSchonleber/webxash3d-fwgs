import { runSettlement, type AdminSettlement } from "./runSettlement";
import { makePublisher } from "./onchain";

const API = process.env.API_BASE ?? "http://localhost:8787";
const ADMIN = process.env.ADMIN_TOKEN ?? "";
const RPC = process.env.RPC_URL ?? "http://localhost:8899";
const ORACLE_KEY = process.env.ORACLE_KEYPAIR ?? "";

function currentUtcHour(): number { return Math.floor(Date.now() / 1_800_000); } // 30-min payout periods

function parseArgs() {
  const a = process.argv.slice(2);
  const hourArg = a[a.indexOf("--hour") + 1];
  const everyArg = a.includes("--every") ? Number(a[a.indexOf("--every") + 1]) : 0;
  return { hourArg, everySec: everyArg };
}

async function settleOnce(hour: number) {
  const publish = makePublisher({ rpcUrl: RPC, oracleKeypairPath: ORACLE_KEY });
  const headers = { authorization: `Bearer ${ADMIN}` };
  const out = await runSettlement(hour, {
    settle: async (h) => (await fetch(`${API}/settle/${h}`, { method: "POST" })).json(),
    fetchSettlement: async (h) => (await fetch(`${API}/admin/settlement/${h}`, { headers })).json() as Promise<AdminSettlement>,
    publish,
  });
  console.log(`[settle] hour ${out.periodId}: ${out.winners} winners, ${out.total} lamports, tx=${out.signature ?? "none"}`);
  return out;
}

async function main() {
  const { hourArg, everySec } = parseArgs();
  const pick = () => (hourArg && hourArg !== "current" ? Number(hourArg) : currentUtcHour() - 1); // settle the just-finished hour
  if (everySec > 0) {
    console.log(`[operator] settling every ${everySec}s. Ctrl-C to stop.`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try { await settleOnce(pick()); } catch (e) { console.error("[settle] error:", e); }
      await new Promise((r) => setTimeout(r, everySec * 1000));
    }
  } else {
    await settleOnce(pick());
  }
}
main();
