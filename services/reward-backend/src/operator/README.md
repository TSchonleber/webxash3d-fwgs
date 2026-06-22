# operator payout tool

Settle a leaderboard period and publish its Merkle payout on-chain — on demand or on an interval.
The oracle key lives only here, never in the public API.

## One-time chain setup (devnet)
    cd ../../..//solana/distributor
    solana-keygen new -o oracle.json            # the operator/oracle key
    solana config set --url devnet
    anchor build && anchor deploy --provider.cluster devnet
    # call initialize(oracle_pubkey), init_vault, then fund the vault PDA with SOL

## Env
    API_BASE=http://localhost:8787
    ADMIN_TOKEN=<same token the backend API was started with>
    RPC_URL=https://api.devnet.solana.com
    ORACLE_KEYPAIR=/abs/path/to/oracle.json

## Pay the top 10 — WHEN YOU CHOOSE (one-shot, settles the just-finished UTC hour)
    npm run operator
    npm run operator -- --hour 495034     # or a specific hour bucket

## Pay on a chosen interval (e.g. every 30 min)
    npm run operator -- --every 1800

Each run: POST /settle/:hour -> GET /admin/settlement/:hour -> publish_period(root,total) signed by the oracle.
Players then claim via the web client (served from the backend's stored settlement).
