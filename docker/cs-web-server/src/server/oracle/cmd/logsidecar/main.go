// logsidecar — tails a ChainStrike game server's HLDS log and feeds kills into
// the reward backend's leaderboard.
//
// Reads log lines from stdin (pipe `docker logs -f <container>` in) or, if
// LOG_PATH is set, tails that file. Because the DM server is persistent (never
// ends a match), it does NOT wait for a map-change: it flushes a LIVE snapshot
// of the current 30-min period every FLUSH_SECONDS under a stable per-period
// matchID, which the backend upserts so the leaderboard tracks cumulative kills.
package main

import (
	"bufio"
	"crypto/ed25519"
	"encoding/base64"
	"log"
	"os"
	"strconv"
	"sync"
	"time"

	"oracle"
)

func main() {
	logPath := env("LOG_PATH", "") // optional; if empty we read stdin
	backend := env("BACKEND_URL", "http://localhost:8787")
	seedB64 := env("ORACLE_SEED_B64", "")
	serverID := env("SERVER_ID", "dm")
	flushSec, _ := strconv.Atoi(env("FLUSH_SECONDS", "10"))
	periodMs, _ := strconv.ParseInt(env("PERIOD_MS", "1800000"), 10, 64) // 30 min
	fallbackName := env("RESOLVE_FALLBACK_NAME", "1") == "1"
	if seedB64 == "" {
		log.Fatal("ORACLE_SEED_B64 is required")
	}
	if flushSec < 1 {
		flushSec = 10
	}
	seed, err := base64.StdEncoding.DecodeString(seedB64)
	if err != nil || len(seed) != ed25519.SeedSize {
		log.Fatalf("ORACLE_SEED_B64 must be base64 of a %d-byte seed", ed25519.SeedSize)
	}
	signer := oracle.NewSigner(ed25519.NewKeyFromSeed(seed))
	reg := oracle.NewRegistryClient(backend)

	// Resolve players by registered wallet; for testing, fall back to the raw
	// in-game name as the identity so the board populates without registration.
	runner := oracle.NewMatchRunner(
		func(_ int, name string) (string, bool) {
			if w, ok := reg.Resolve(name); ok {
				return w, true
			}
			if fallbackName && name != "" {
				return name, true
			}
			return "", false
		},
		func(res oracle.MatchResult) error { return signer.Post(backend+"/results", res) },
	)

	var mu sync.Mutex
	lastPeriod := int64(-1)

	// Periodic live flush of the current period's tally.
	go func() {
		t := time.NewTicker(time.Duration(flushSec) * time.Second)
		defer t.Stop()
		for range t.C {
			now := time.Now().UnixMilli()
			p := now / periodMs
			mu.Lock()
			if p != lastPeriod {
				if lastPeriod >= 0 {
					// finalize the period that just closed, then start fresh
					_ = runner.Snapshot(serverID+"-"+strconv.FormatInt(lastPeriod, 10), lastPeriod*periodMs+periodMs-1)
					runner.Reset()
				}
				lastPeriod = p
			}
			if err := runner.Snapshot(serverID+"-"+strconv.FormatInt(p, 10), now); err != nil {
				log.Printf("snapshot post failed: %v", err)
			}
			mu.Unlock()
		}
	}()

	feed := func(line string) {
		mu.Lock()
		runner.Feed(line)
		mu.Unlock()
	}

	log.Printf("logsidecar[%s] -> %s (flush %ds)", serverID, backend, flushSec)
	if logPath != "" {
		oracle.TailFile(logPath, feed, make(chan struct{}))
		return
	}
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		feed(sc.Text())
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
