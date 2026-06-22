/** Shorten a base58 address: AbCd…WxYz */
export function shortWallet(addr: string, head = 4, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** lamports (string) -> human SOL-ish token amount with thousands separators. */
export function formatTokenAmount(lamports: string, decimals = 9): string {
  let big: bigint;
  try {
    big = BigInt(lamports);
  } catch {
    return "0";
  }
  const base = 10n ** BigInt(decimals);
  const whole = big / base;
  const frac = big % base;
  const wholeStr = whole.toLocaleString("en-US");
  if (frac === 0n) return wholeStr;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2).replace(/0+$/, "");
  return fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
}

/** Format ms remaining as HH:MM:SS segments. */
export function splitClock(ms: number): { hh: string; mm: string; ss: string } {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return { hh: pad(hh), mm: pad(mm), ss: pad(ss) };
}
