package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"log"
	"os"
	"regexp"
	"time"

	"oracle"
)

func main() {
	logPath := env("LOG_PATH", "")
	backend := env("BACKEND_URL", "http://localhost:8787")
	seedB64 := env("ORACLE_SEED_B64", "") // base64 of a 32-byte ed25519 seed
	endPat := regexp.MustCompile(env("MATCH_END_PATTERN", `: Started map|-+ Mapchange`))
	if logPath == "" || seedB64 == "" {
		log.Fatal("LOG_PATH and ORACLE_SEED_B64 are required")
	}

	seed, err := base64.StdEncoding.DecodeString(seedB64)
	if err != nil || len(seed) != ed25519.SeedSize {
		log.Fatalf("ORACLE_SEED_B64 must be base64 of a %d-byte seed", ed25519.SeedSize)
	}
	signer := oracle.NewSigner(ed25519.NewKeyFromSeed(seed))
	reg := oracle.NewRegistryClient(backend)

	runner := oracle.NewMatchRunner(
		func(_ int, name string) (string, bool) { return reg.Resolve(name) },
		func(res oracle.MatchResult) error { return signer.Post(backend+"/results", res) },
	)

	matchN := 0
	stop := make(chan struct{})
	log.Printf("logsidecar tailing %s -> %s", logPath, backend)
	oracle.TailFile(logPath, func(line string) {
		runner.Feed(line)
		if endPat.MatchString(line) {
			matchN++
			id := time.Now().Format("20060102T150405") // stamped match id
			if err := runner.Finalize(id, nowMs()); err != nil {
				log.Printf("post failed for match %d: %v", matchN, err)
			} else {
				log.Printf("posted match %s", id)
			}
		}
	}, stop)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func nowMs() int64 { return time.Now().UnixMilli() }
