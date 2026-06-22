# distributor

Hourly Merkle leaderboard payout program (Phase 0, native SOL).

## Test
    anchor test

## Devnet deploy
    solana config set --url devnet
    anchor build && anchor deploy --provider.cluster devnet
    # then: initialize(oracle_pubkey), init_vault, fund the vault PDA

## Merkle convention
- leaf = keccak256(index_u64_le || claimant_32 || amount_u64_le)
- parent = keccak256(sorted(a,b))
The Plan-2 backend MUST build roots identically (see tests/merkle.ts).
