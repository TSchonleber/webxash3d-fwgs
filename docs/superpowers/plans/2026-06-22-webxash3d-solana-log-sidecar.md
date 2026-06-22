# webxash3d Solana — Phase 0 / Plan 8: Log Sidecar + Session Registration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Connect a running game server to the backend **without recompiling the engine**: a standalone Go sidecar tails the HLDS log, builds a signed `MatchResult` (reusing the tested Plan 4 oracle package), and POSTs it to the backend `/results`; plus a backend endpoint where the web client registers its `playerName → wallet` so the sidecar can resolve in-game identities to wallets.

**Architecture:** The sidecar lives inside the existing isolated `oracle` Go module (`cmd/logsidecar`) so it builds with **stdlib + the oracle package only** — no CGO/engine. It tails a log file (configurable path), tracks `uid → name` from enter/kill lines, aggregates per match, and on a configurable match-end pattern resolves `name → wallet` via the backend, signs (ed25519), and POSTs. Identity binding is **name-based** for Phase 0 (browser players have no Steam IDs): the client registers `{playerName, wallet}` and uses that exact name in-game.

**Tech Stack:** Go 1.25 stdlib + the `oracle` package; TypeScript (backend endpoint) + vitest.

**Prereqs:** Plan 4 oracle module green; Plan 5/7 backend green.

**Assumptions to confirm at server hookup (isolated as config, so adjustment is trivial):**
- The server can write/expose a standard HLDS log (file path) — `LOG_PATH`.
- Players are identified by the in-game **name** they registered — resolution is name-based.
- Match end is detectable by a log pattern — `MATCH_END_PATTERN` (default: map change).

---

## File Structure
- Modify: `services/reward-backend/src/api/app.ts` + `app.test.ts` — `POST /register`, `GET /resolve/:name`
- Create: `docker/cs-web-server/src/server/oracle/registry_client.go` + `_test.go` — backend name→wallet resolver client
- Create: `docker/cs-web-server/src/server/oracle/tail.go` + `tail_test.go` — follow-a-file line reader
- Create: `docker/cs-web-server/src/server/oracle/runner.go` + `runner_test.go` — lines → matches → sign → post
- Create: `docker/cs-web-server/src/server/oracle/cmd/logsidecar/main.go` — the binary
- Create: `docker/cs-web-server/src/server/oracle/SIDECAR.md` — run guide

---

### Task 1: Backend registration + resolve endpoints

`POST /register {playerName, wallet}` stores the mapping; `GET /resolve/:name` returns `{wallet}` or 404. In-memory for Phase 0.

- [ ] **Step 1: Add failing tests** — append to `services/reward-backend/src/api/app.test.ts`
```ts
  it("registers a player name -> wallet and resolves it", async () => {
    const app = createApp(deps);
    const reg = await app.request("/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "neo", wallet: "WalletNeo" }),
    });
    expect(reg.status).toBe(200);
    const res = await app.request("/resolve/neo");
    expect(res.status).toBe(200);
    expect((await res.json()).wallet).toBe("WalletNeo");
  });

  it("resolve returns 404 for unknown name", async () => {
    const res = await createApp(deps).request("/resolve/ghost");
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: Run & verify fail** — `cd services/reward-backend && npm test`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/api/app.ts`, add a name→wallet map in `createApp` and two routes (before `return app`):
```ts
  const nameToWallet = new Map<string, string>();

  app.post("/register", async (c) => {
    const { playerName, wallet } = (await c.req.json()) as { playerName?: string; wallet?: string };
    if (!playerName || !wallet) return c.json({ error: "playerName and wallet required" }, 400);
    nameToWallet.set(playerName, wallet);
    return c.json({ registered: true });
  });

  app.get("/resolve/:name", (c) => {
    const wallet = nameToWallet.get(c.req.param("name"));
    if (!wallet) return c.json({ error: "unknown name" }, 404);
    return c.json({ wallet });
  });
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: all API tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/api/app.ts services/reward-backend/src/api/app.test.ts
git commit -m "feat(api): player-name -> wallet registration + resolve endpoints"
```

---

### Task 2: Resolver client (Go → backend)

- [ ] **Step 1: Write the failing test** — `docker/cs-web-server/src/server/oracle/registry_client_test.go`
```go
package oracle

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegistryClientResolve(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/resolve/neo" {
			w.Write([]byte(`{"wallet":"WalletNeo"}`)); return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()

	c := NewRegistryClient(srv.URL)
	w, ok := c.Resolve("neo")
	if !ok || w != "WalletNeo" { t.Fatalf("resolve neo: %v %s", ok, w) }
	if _, ok := c.Resolve("ghost"); ok { t.Fatal("ghost must be unresolved") }
}
```

- [ ] **Step 2: Run & verify fail** — `cd docker/cs-web-server/src/server/oracle && go test ./...` Expected: FAIL.

- [ ] **Step 3: Implement** — `registry_client.go`
```go
package oracle

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type RegistryClient struct{ base string }

func NewRegistryClient(base string) *RegistryClient { return &RegistryClient{base: base} }

// Resolve returns the wallet for an in-game player name, ok=false if unknown.
func (c *RegistryClient) Resolve(name string) (string, bool) {
	resp, err := http.Get(fmt.Sprintf("%s/resolve/%s", c.base, name))
	if err != nil { return "", false }
	defer resp.Body.Close()
	if resp.StatusCode != 200 { return "", false }
	var body struct{ Wallet string `json:"wallet"` }
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil { return "", false }
	return body.Wallet, body.Wallet != ""
}
```

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/registry_client.go docker/cs-web-server/src/server/oracle/registry_client_test.go
git commit -m "feat(oracle): backend name->wallet resolver client"
```

---

### Task 3: Match runner (lines → MatchResult → sign → post)

Consumes log lines, tracks `uid → name` from `EnterEvent`/`KillEvent`, aggregates, and on a match-end signal finalizes: resolves each uid's name → wallet, builds the result, signs, and posts. Resolver + poster injected for testing.

- [ ] **Step 1: Write the failing test** — `runner_test.go`
```go
package oracle

import "testing"

func TestRunnerFinalizePostsResolvedResult(t *testing.T) {
	posted := []MatchResult{}
	r := NewMatchRunner(
		func(uid int, name string) (string, bool) { // resolver: name -> wallet
			m := map[string]string{"alice": "Wa", "bob": "Wb"}; w, ok := m[name]; return w, ok
		},
		func(res MatchResult) error { posted = append(posted, res); return nil }, // poster
	)
	r.Feed(`L d: "alice<2><id><CT>" entered the game`)
	r.Feed(`L d: "bob<3><id><TERRORIST>" entered the game`)
	r.Feed(`L d: "alice<2><id><CT>" killed "bob<3><id><TERRORIST>" with "ak47"`)
	r.Feed(`L d: "alice<2><id><CT>" triggered "headshot"`)
	r.Feed(`L d: Team "CT" triggered "CTs_Win" (CT "1") (T "0")`)
	r.Finalize("match-9", 1234)

	if len(posted) != 1 { t.Fatalf("want 1 posted result, got %d", len(posted)) }
	res := posted[0]
	if res.MatchID != "match-9" || res.EndedAtMs != 1234 { t.Fatal("header") }
	var alice *MatchPlayer
	for i := range res.Players { if res.Players[i].Wallet == "Wa" { alice = &res.Players[i] } }
	if alice == nil || alice.Kills != 1 || alice.Headshots != 1 || !alice.Won { t.Fatalf("alice: %+v", res.Players) }
}

func TestRunnerResetsAfterFinalize(t *testing.T) {
	posted := 0
	r := NewMatchRunner(
		func(uid int, name string) (string, bool) { return "W", true },
		func(res MatchResult) error { posted++; return nil },
	)
	r.Feed(`L d: "x<2><id><CT>" entered the game`)
	r.Finalize("m1", 1)
	r.Finalize("m2", 2) // no events since reset -> still posts (possibly empty), but must not duplicate m1 players
	if posted != 2 { t.Fatalf("want 2 posts, got %d", posted) }
}
```

- [ ] **Step 2: Run & verify fail** — `go test ./...` Expected: FAIL, `NewMatchRunner` missing.

- [ ] **Step 3: Implement** — `runner.go`
```go
package oracle

// nameResolver maps an in-game (uid,name) to a wallet. ok=false drops the player.
type nameResolver func(uid int, name string) (string, bool)
type poster func(res MatchResult) error

type MatchRunner struct {
	resolve  nameResolver
	post     poster
	names    map[int]string // uid -> latest name
	agg      *Aggregator
}

func NewMatchRunner(resolve nameResolver, post poster) *MatchRunner {
	r := &MatchRunner{resolve: resolve, post: post}
	r.reset()
	return r
}

func (r *MatchRunner) reset() {
	r.names = map[int]string{}
	// aggregator resolves uid->wallet via the latest known name for that uid
	r.agg = NewAggregator("", func(uid int) (string, bool) {
		name, ok := r.names[uid]
		if !ok { return "", false }
		return r.resolve(uid, name)
	})
}

// Feed parses one log line and records identity + stats.
func (r *MatchRunner) Feed(line string) {
	ev, ok := ParseLine(line)
	if !ok { return }
	switch e := ev.(type) {
	case EnterEvent:
		r.names[e.UID] = e.Name
	case KillEvent:
		// names may be embedded only in enter lines; kills carry uids — names already tracked
	}
	r.agg.Add(ev)
}

// Finalize builds the result for the just-finished match, posts it, and resets.
func (r *MatchRunner) Finalize(matchID string, endedAtMs int64) error {
	r.agg.matchID = matchID
	res := r.agg.Finalize(endedAtMs)
	err := r.post(res)
	r.reset()
	return err
}
```
> Note: `Aggregator.matchID` is unexported but in-package, so the runner can set it. The aggregator's resolver closure reads `r.names` live, so it sees names accumulated during the match.

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: runner tests PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/runner.go docker/cs-web-server/src/server/oracle/runner_test.go
git commit -m "feat(oracle): match runner (lines -> resolved MatchResult -> post)"
```

---

### Task 4: File tailer

Follows a file from the end, yielding new lines as they're appended (like `tail -f`). Tested by writing to a temp file.

- [ ] **Step 1: Write the failing test** — `tail_test.go`
```go
package oracle

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTailReadsAppendedLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.log")
	os.WriteFile(path, []byte("line1\n"), 0644)

	lines := make(chan string, 8)
	stop := make(chan struct{})
	go TailFile(path, func(l string) { lines <- l }, stop)

	time.Sleep(50 * time.Millisecond)
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	f.WriteString("line2\nline3\n")
	f.Close()

	got := []string{}
	timeout := time.After(2 * time.Second)
	for len(got) < 2 {
		select {
		case l := <-lines: got = append(got, l)
		case <-timeout: t.Fatalf("timeout, got %v", got)
		}
	}
	close(stop)
	if got[0] != "line2" || got[1] != "line3" { t.Fatalf("appended lines: %v", got) }
}
```

- [ ] **Step 2: Run & verify fail** — `go test ./...` Expected: FAIL, `TailFile` missing.

- [ ] **Step 3: Implement** — `tail.go`
```go
package oracle

import (
	"bufio"
	"io"
	"os"
	"strings"
	"time"
)

// TailFile follows a file from its current end, calling onLine for each newly appended line
// until stop is closed. New lines only (existing content is skipped).
func TailFile(path string, onLine func(string), stop <-chan struct{}) error {
	f, err := os.Open(path)
	if err != nil { return err }
	defer f.Close()
	f.Seek(0, io.SeekEnd)
	reader := bufio.NewReader(f)
	for {
		select {
		case <-stop:
			return nil
		default:
		}
		line, err := reader.ReadString('\n')
		if err == io.EOF {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		if err != nil { return err }
		onLine(strings.TrimRight(line, "\r\n"))
	}
}
```

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: ALL oracle tests PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/tail.go docker/cs-web-server/src/server/oracle/tail_test.go
git commit -m "feat(oracle): tail -f style file follower"
```

---

### Task 5: Sidecar binary + run guide

- [ ] **Step 1: Create `cmd/logsidecar/main.go`**
```go
package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"log"
	"os"
	"regexp"

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

func env(k, def string) string { if v := os.Getenv(k); v != "" { return v }; return def }
```
> Add the missing imports the implementer needs: `"time"` and a `nowMs()` helper (`func nowMs() int64 { return time.Now().UnixMilli() }`). Adjust the match-id/timestamp as preferred.

- [ ] **Step 2: Build the binary**

Run:
```bash
cd ~/Desktop/webxash3d-fwgs/docker/cs-web-server/src/server/oracle
go build ./cmd/logsidecar
go vet ./...
```
Expected: builds clean; `go test ./...` still green.

- [ ] **Step 3: Create `SIDECAR.md`**
```markdown
# logsidecar

Standalone binary (no engine/CGO). Tails the game server's HLDS log, signs each finished match,
and POSTs it to the backend /results. Reuses the oracle package.

## Build & run
    go build ./cmd/logsidecar
    LOG_PATH=/path/to/server.log \
    BACKEND_URL=http://localhost:8787 \
    ORACLE_SEED_B64=<base64 32-byte ed25519 seed; its pubkey must be in the backend OPERATOR_PUBKEYS allowlist> \
    MATCH_END_PATTERN=': Started map|-+ Mapchange' \
    ./logsidecar

## Identity
Players are resolved by in-game NAME. The web client must POST /register {playerName, wallet}
and join with that exact name. (Confirm at hookup whether the server exposes a log file path,
how match end appears in the log, and the player-name scheme — all are config above.)
```

- [ ] **Step 4: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/cmd docker/cs-web-server/src/server/oracle/SIDECAR.md
git commit -m "feat(oracle): logsidecar binary + run guide"
```

---

## Self-Review

**Spec coverage (this plan = §4 server feeds the backend, §5 wallet binding, §10 signed results — without recompiling the engine):**
- §4/§6 server results reach the backend → sidecar `TailFile` → `MatchRunner` → `Signer.Post` to `/results`. ✅
- §5 wallet binding → name-based via `/register` + `RegistryClient.Resolve` (browser players have no Steam IDs). ✅
- §10 operator-signed → reuses the Plan 4 ed25519 `Signer`; sidecar pubkey goes in the backend allowlist. ✅
- Engine untouched → sidecar is a separate binary in the stdlib-only `oracle` module; nothing in `main.go`/`sfu.go` changes. ✅

**Placeholder scan:** none in shipped code. `main.go` reads real env with documented defaults; the implementer adds the noted `time` import + `nowMs()` helper.

**Type consistency:** `RegistryClient.Resolve(name) (string,bool)` feeds `MatchRunner`'s `nameResolver(uid,name)`. `MatchRunner` reuses Plan 4 `Aggregator`/`ParseLine`/`Signer`/`MatchResult` unchanged. The aggregator's `Resolver` is `func(uid int)(string,bool)` — the runner adapts name→wallet through the live `names` map. Backend `/register`+`/resolve` JSON (`{playerName,wallet}` / `{wallet}`) matches the Go client.

**Known follow-ups (confirm at server hookup):** real log source (file path vs stdout vs RCON), the exact match-end log signature, and whether name uniqueness needs enforcing (client should use a wallet-derived unique name); persistence of registrations; running the sidecar as a service alongside the game server.
```
