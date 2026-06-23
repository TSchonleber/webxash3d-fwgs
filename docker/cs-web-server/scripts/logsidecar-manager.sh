#!/bin/bash
# Auto-scaling log-oracle manager.
#
# Runs exactly one logsidecar per running `cs-web-server-dm*` game container and
# feeds them all into one combined leaderboard. New servers attach automatically;
# removed servers detach when their container stops. Each server gets a distinct
# SERVER_ID (its container name minus the compose prefix) so their match snapshots
# don't overwrite each other in the backend.
#
# Deploy as a systemd service (see chainstrike-logsidecar-manager.service). It
# replaces the per-server logsidecar units.

export ORACLE_SEED_B64="$(cat /home/ubuntu/oracle_seed_b64.txt)"
export BACKEND_URL="http://localhost:8787"
export FLUSH_SECONDS=10
export PERIOD_MS=900000
export RESOLVE_FALLBACK_NAME=1
BIN=/home/ubuntu/logsidecar
LOG=/home/ubuntu/logsidecar-mgr.log

echo "[$(date)] logsidecar-manager started" >>"$LOG"

while true; do
  for c in $(docker ps --filter "name=cs-web-server-dm" --format '{{.Names}}'); do
    pidf="/tmp/oracle-$c.pid"
    # skip if a healthy logsidecar wrapper is already attached to this container
    if [ -f "$pidf" ] && kill -0 "$(cat "$pidf" 2>/dev/null)" 2>/dev/null; then
      continue
    fi
    sid="${c#cs-web-server-}"
    # inner wrapper inherits the oracle env; re-pipes docker logs if the
    # container restarts, and exits (detaches) when the container stops.
    setsid bash -c "export SERVER_ID='$sid'
      while [ \"\$(docker inspect -f '{{.State.Running}}' '$c' 2>/dev/null)\" = true ]; do
        docker logs -f --tail 0 '$c' 2>&1 | '$BIN'
        sleep 2
      done
      echo \"[\$(date)] detached <- $c\" >>'$LOG'" </dev/null >>"$LOG" 2>&1 &
    echo $! >"$pidf"
    echo "[$(date)] attached -> $c (SERVER_ID=$sid)" >>"$LOG"
  done
  sleep 15
done
