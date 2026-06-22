# reward-backend

Pure settlement domain logic for the hourly leaderboard payouts (Phase 0, Plan 2).

## Test
    npm install
    npm test

## Modules
- `period` UTC hour bucketing (period_id)
- `merkle` keccak Merkle tree — byte-identical to `solana/distributor`
- `leaderboard` hourly points engine
- `payout` solvency-capped top-10 split
- `anticheat` tier-1 heuristics
- `eligibility` hold-≥N token balance (injected reader, fail-closed)
- `settle` pipeline: rank → screen → gate → split → root

## Deferred (later plans)
On-chain publisher (calls `publish_period` as the oracle), HTTP API (ingest results, serve proofs),
MMR matchmaking, KYC gating, the N+1-hour verification buffer.
