import { useEligibility } from "../lib/eligibility";

/**
 * Hold-eligibility badge. Reflects the real play gate:
 *  - pre-launch (no mint configured) / bypass => "Pre-launch" (gate open)
 *  - gate active => live on-chain balance check against the minimum hold
 */
export function EligibilityBadge() {
  const e = useEligibility();

  if (!e.gateActive) {
    return (
      <span className="badge pre" title="Token gate activates once the $TOKEN mint is set — open to all for now">
        Pre-launch · open
      </span>
    );
  }

  if (e.status === "loading") {
    return <span className="badge pre" title="Reading your on-chain balance">Checking…</span>;
  }

  if (e.eligible) {
    return (
      <span className="badge ok" title={`Holding ≥ ${e.required} $TOKEN`}>
        <span className="tick">✓</span> Eligible
      </span>
    );
  }

  return (
    <span className="badge no" title="Hold the minimum $TOKEN to enter matches">
      Need ≥ {e.required} $TOKEN
    </span>
  );
}
