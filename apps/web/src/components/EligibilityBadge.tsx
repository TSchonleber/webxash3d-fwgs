import { DEV_BYPASS } from "../lib/config";
import { useAuth } from "../lib/auth";

const MIN_HOLD = 1000;

/**
 * Hold-eligibility badge. The real on-chain balance read is wired later
 * (the backend already has rpcBalanceReader). For now: dev-bypass / connected
 * wallet => eligible; no wallet => not eligible.
 */
export function EligibilityBadge() {
  const { walletAddress } = useAuth();
  const eligible = DEV_BYPASS || !!walletAddress;

  if (eligible) {
    return (
      <span className="badge ok" title={`Holding ≥ ${MIN_HOLD} $TOKEN`}>
        <span className="tick">✓</span> Eligible
      </span>
    );
  }
  return (
    <span className="badge no" title="Connect a wallet holding the minimum to play for rewards">
      Need ≥ {MIN_HOLD} $TOKEN
    </span>
  );
}
