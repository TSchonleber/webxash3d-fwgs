#!/bin/bash
# ChainStrike payout scheduler.
#
# Fires the payout ~OFFSET seconds after each round boundary — tighter than the
# old :01/:16/:31/:46 cron (60s offset). The OFFSET gives the log oracle time to
# post the closing round's final kill snapshot before paying. Keep OFFSET in sync
# with PAYOUT_OFFSET_MS in apps/web/src/lib/config.ts so the on-site countdown
# hits 0 right when SOL disperses. Runs as a systemd service; replaces the cron.
PERIOD=900   # 15-min rounds, seconds
OFFSET=20    # seconds after the boundary to pay

while true; do
  now=$(date +%s)
  target=$(( (now / PERIOD + 1) * PERIOD + OFFSET ))
  sleep $(( target - now ))
  /home/ubuntu/run-payout.sh
done
