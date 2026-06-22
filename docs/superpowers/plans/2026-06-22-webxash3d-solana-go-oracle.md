# webxash3d Solana — Phase 0 / Plan 4: Go Server Oracle Hooks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The trusted-oracle pieces that the game server needs: bind a Privy-authenticated wallet to each browser connection, turn the embedded CS engine's match into a structured authoritative `MatchResult`, ed25519-sign it as an operator server, and POST it to the reward backend.

**Architecture:** A standalone, **stdlib-only** Go module `oracle` (nested under the cs-web-server server dir) so it unit-tests in milliseconds without the CGO/WebRTC/engine build. It contains pure logic: HLDS log-line parsing, event aggregation into a `MatchResult`, a connection-index→wallet session registry behind a `TokenVerifier` interface, and an ed25519 signer + HTTP poster. The actual engine-log tap and the `websocketHandler` auth gate are small, documented **wire-in seams** in `sfu.go` (not part of the testable core, since they depend on the upstream `goxash3d-fwgs` engine API which is out of scope to modify here).

**Tech Stack:** Go 1.25, stdlib only (`crypto/ed25519`, `net/http`, `regexp`, `encoding/json`, `testing`, `net/http/httptest`).

**Context discovered (real, from reading the server):**
- `docker/cs-web-server/src/server/main.go` embeds the engine (`goxash3d_fwgs.DefaultXash3D.SysStart()`) and runs the SFU in a goroutine.
- `sfu.go` `websocketHandler` accepts ALL origins with **no auth**; each connection gets a pool index `index` (`ip[0]`), and `connections[index]` is its datachannel writer. That `index` is the per-connection identity to map to a wallet.
- The relay forwards **opaque GoldSrc netchannel bytes** — it has no game-state visibility, so results must come from the engine's **HLDS log output** (standard CS 1.6 log format).

**JSON contract (MUST match the reward-backend `MatchResult` from Plan 2 `services/reward-backend/src/types.ts`):**
`{ matchId, endedAtMs, players: [{ wallet, team, won, kills, deaths, headshots, shotsFired, shotsHit, avgReactionMs }] }`.
The log parser can derive `kills/deaths/headshots/team/won`; `shotsFired/shotsHit/avgReactionMs` are not in standard logs, so the aggregator fills **benign defaults** (`shotsFired:0, shotsHit:0, avgReactionMs:300`) so Phase-0 tier-1 anti-cheat only acts on log-derived signals (headshot ratio, kills) — richer telemetry is a later AMXX-plugin concern.

---

## File Structure (all under `docker/cs-web-server/src/server/oracle/`)
- Create: `go.mod` — standalone module `oracle`
- Create: `types.go` — `MatchResult`, `MatchPlayer` (JSON-tagged to match the backend)
- Create: `logparse.go` + `logparse_test.go` — HLDS log line → typed events
- Create: `aggregate.go` + `aggregate_test.go` — events → `MatchResult`
- Create: `session.go` + `session_test.go` — `TokenVerifier` + index→wallet registry
- Create: `oracle.go` + `oracle_test.go` — ed25519 sign + POST to backend
- Create: `README.md` — wire-in seams for `sfu.go`/`main.go`

---

### Task 1: Module scaffold

- [ ] **Step 1: Init the module**
```bash
cd ~/Desktop/webxash3d-fwgs/docker/cs-web-server/src/server
mkdir -p oracle && cd oracle
go mod init oracle
go test ./... 2>&1   # expect: "no test files" / no packages, exit 0-ish
```

- [ ] **Step 2: Commit**
```bash
cd ~/Desktop/webxash3d-fwgs
git add docker/cs-web-server/src/server/oracle/go.mod
git commit -m "chore(oracle): scaffold standalone go module"
```

---

### Task 2: Result types

- [ ] **Step 1: Create `types.go`**
```go
package oracle

// MatchPlayer mirrors services/reward-backend/src/types.ts MatchPlayer (JSON field names must match).
type MatchPlayer struct {
	Wallet       string `json:"wallet"`
	Team         string `json:"team"` // "A" or "B"
	Won          bool   `json:"won"`
	Kills        int    `json:"kills"`
	Deaths       int    `json:"deaths"`
	Headshots    int    `json:"headshots"`
	ShotsFired   int    `json:"shotsFired"`
	ShotsHit     int    `json:"shotsHit"`
	AvgReactionMs int   `json:"avgReactionMs"`
}

// MatchResult mirrors services/reward-backend/src/types.ts MatchResult.
type MatchResult struct {
	MatchID  string        `json:"matchId"`
	EndedAtMs int64        `json:"endedAtMs"`
	Players  []MatchPlayer `json:"players"`
}
```

- [ ] **Step 2: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/types.go
git commit -m "feat(oracle): match result types matching backend contract"
```

---

### Task 3: HLDS log parser

Parse the documented CS 1.6 / HLDS log subset into typed events. The `<uid>` (userid) is the in-game identity we later map to a wallet.

- [ ] **Step 1: Write the failing test** — `logparse_test.go`
```go
package oracle

import "testing"

func TestParseKill(t *testing.T) {
	line := `L 06/22/2026 - 10:00:01: "Alice<2><STEAM_0:1:11><CT>" killed "Bob<3><STEAM_0:1:22><TERRORIST>" with "ak47"`
	ev, ok := ParseLine(line)
	if !ok { t.Fatal("expected parse ok") }
	k, isKill := ev.(KillEvent)
	if !isKill { t.Fatalf("expected KillEvent, got %T", ev) }
	if k.KillerUID != 2 || k.VictimUID != 3 || k.KillerTeam != "CT" || k.VictimTeam != "TERRORIST" {
		t.Fatalf("bad kill parse: %+v", k)
	}
}

func TestParseHeadshot(t *testing.T) {
	line := `L 06/22/2026 - 10:00:01: "Alice<2><STEAM_0:1:11><CT>" triggered "headshot"`
	ev, ok := ParseLine(line)
	if !ok { t.Fatal("ok") }
	h, is := ev.(HeadshotEvent)
	if !is || h.UID != 2 { t.Fatalf("bad headshot: %+v", ev) }
}

func TestParseTeamWin(t *testing.T) {
	line := `L 06/22/2026 - 10:05:00: Team "CT" triggered "CTs_Win" (CT "3") (T "1")`
	ev, ok := ParseLine(line)
	if !ok { t.Fatal("ok") }
	w, is := ev.(TeamWinEvent)
	if !is || w.Team != "CT" { t.Fatalf("bad teamwin: %+v", ev) }
}

func TestParseEntered(t *testing.T) {
	line := `L 06/22/2026 - 10:00:00: "Alice<2><STEAM_0:1:11><>" entered the game`
	ev, ok := ParseLine(line)
	if !ok { t.Fatal("ok") }
	c, is := ev.(EnterEvent)
	if !is || c.UID != 2 || c.Name != "Alice" { t.Fatalf("bad enter: %+v", ev) }
}

func TestParseUnknownReturnsFalse(t *testing.T) {
	if _, ok := ParseLine(`L 06/22/2026 - 10:00:00: some unrelated line`); ok {
		t.Fatal("unknown line must return ok=false")
	}
}
```

- [ ] **Step 2: Run & verify fail** — `go test ./...` Expected: FAIL, undefined `ParseLine`/event types.

- [ ] **Step 3: Implement** — `logparse.go`
```go
package oracle

import (
	"regexp"
	"strconv"
)

type Event interface{ isEvent() }

type KillEvent struct {
	KillerUID, VictimUID     int
	KillerTeam, VictimTeam   string
	Weapon                   string
}
type HeadshotEvent struct{ UID int }
type TeamWinEvent struct{ Team string }
type EnterEvent struct {
	UID  int
	Name string
}

func (KillEvent) isEvent()     {}
func (HeadshotEvent) isEvent() {}
func (TeamWinEvent) isEvent()  {}
func (EnterEvent) isEvent()    {}

// "Name<uid><steamid><team>"
const player = `"([^"]*)<(\d+)><[^>]*><([^>]*)>"`

var (
	reKill     = regexp.MustCompile(player + ` killed ` + player + ` with "([^"]*)"`)
	reHeadshot = regexp.MustCompile(player + ` triggered "headshot"`)
	reTeamWin  = regexp.MustCompile(`Team "([^"]*)" triggered "[^"]*_Win"`)
	reEnter    = regexp.MustCompile(player + ` entered the game`)
)

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

// ParseLine returns a typed Event and ok=true if the line matches a known event.
func ParseLine(line string) (Event, bool) {
	if m := reKill.FindStringSubmatch(line); m != nil {
		return KillEvent{
			KillerUID: atoi(m[2]), KillerTeam: m[3],
			VictimUID: atoi(m[5]), VictimTeam: m[6], Weapon: m[7],
		}, true
	}
	if m := reHeadshot.FindStringSubmatch(line); m != nil {
		return HeadshotEvent{UID: atoi(m[2])}, true
	}
	if m := reTeamWin.FindStringSubmatch(line); m != nil {
		return TeamWinEvent{Team: m[1]}, true
	}
	if m := reEnter.FindStringSubmatch(line); m != nil {
		return EnterEvent{UID: atoi(m[2]), Name: m[1]}, true
	}
	return nil, false
}
```
> Note on regex group indices: `player` has 3 groups. In `reKill` the killer is groups 1-3 and victim 4-6, weapon 7. In `reHeadshot`/`reEnter` the uid is group 2.

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: parser tests PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/logparse.go docker/cs-web-server/src/server/oracle/logparse_test.go
git commit -m "feat(oracle): HLDS log line parser (kill/headshot/teamwin/enter)"
```

---

### Task 4: Aggregator (events → MatchResult)

Folds a match's events into a `MatchResult`. Maps `uid → wallet` via a resolver; players whose uid has no wallet are dropped. Team mapping: HLDS `CT` → `"A"`, `TERRORIST` → `"B"`. `won = true` for players on the team with the most round wins.

- [ ] **Step 1: Write the failing test** — `aggregate_test.go`
```go
package oracle

import "testing"

func TestAggregate(t *testing.T) {
	resolver := func(uid int) (string, bool) {
		m := map[int]string{2: "Wallet_Alice", 3: "Wallet_Bob"}
		w, ok := m[uid]; return w, ok
	}
	agg := NewAggregator("match-1", resolver)
	agg.Add(EnterEvent{UID: 2, Name: "Alice"})
	agg.Add(EnterEvent{UID: 3, Name: "Bob"})
	agg.Add(KillEvent{KillerUID: 2, KillerTeam: "CT", VictimUID: 3, VictimTeam: "TERRORIST", Weapon: "ak47"})
	agg.Add(HeadshotEvent{UID: 2})
	agg.Add(TeamWinEvent{Team: "CT"})
	res := agg.Finalize(1_000_000)

	if res.MatchID != "match-1" || res.EndedAtMs != 1_000_000 { t.Fatal("header") }
	if len(res.Players) != 2 { t.Fatalf("want 2 players, got %d", len(res.Players)) }
	var alice *MatchPlayer
	for i := range res.Players { if res.Players[i].Wallet == "Wallet_Alice" { alice = &res.Players[i] } }
	if alice == nil { t.Fatal("alice missing") }
	if alice.Kills != 1 || alice.Headshots != 1 || alice.Team != "A" || !alice.Won { t.Fatalf("alice: %+v", *alice) }
	if alice.AvgReactionMs != 300 { t.Fatalf("expected benign reaction default, got %d", alice.AvgReactionMs) }
}

func TestAggregateDropsUnmappedUID(t *testing.T) {
	resolver := func(uid int) (string, bool) { return "", false } // nobody mapped
	agg := NewAggregator("m", resolver)
	agg.Add(KillEvent{KillerUID: 2, KillerTeam: "CT", VictimUID: 3, VictimTeam: "TERRORIST"})
	res := agg.Finalize(1)
	if len(res.Players) != 0 { t.Fatalf("unmapped uids must be dropped, got %d", len(res.Players)) }
}
```

- [ ] **Step 2: Run & verify fail** — `go test ./...` Expected: FAIL, undefined `NewAggregator`.

- [ ] **Step 3: Implement** — `aggregate.go`
```go
package oracle

// Resolver maps an in-game userid to a wallet (base58). ok=false drops the player.
type Resolver func(uid int) (string, bool)

type stat struct {
	team                   string
	kills, deaths, headsh  int
}

type Aggregator struct {
	matchID  string
	resolve  Resolver
	players  map[int]*stat // uid -> stat
	roundWins map[string]int // "A"/"B" -> wins
}

func NewAggregator(matchID string, r Resolver) *Aggregator {
	return &Aggregator{matchID: matchID, resolve: r, players: map[int]*stat{}, roundWins: map[string]int{}}
}

func teamCode(hlds string) string {
	if hlds == "CT" { return "A" }
	return "B" // TERRORIST and anything else
}

func (a *Aggregator) ensure(uid int, team string) *stat {
	s := a.players[uid]
	if s == nil { s = &stat{}; a.players[uid] = s }
	if team != "" { s.team = teamCode(team) }
	return s
}

func (a *Aggregator) Add(ev Event) {
	switch e := ev.(type) {
	case EnterEvent:
		a.ensure(e.UID, "")
	case KillEvent:
		a.ensure(e.KillerUID, e.KillerTeam).kills++
		a.ensure(e.VictimUID, e.VictimTeam).deaths++
	case HeadshotEvent:
		a.ensure(e.UID, "").headsh++
	case TeamWinEvent:
		a.roundWins[teamCode(e.Team)]++
	}
}

func (a *Aggregator) Finalize(endedAtMs int64) MatchResult {
	winTeam := ""
	if a.roundWins["A"] != a.roundWins["B"] {
		if a.roundWins["A"] > a.roundWins["B"] { winTeam = "A" } else { winTeam = "B" }
	}
	res := MatchResult{MatchID: a.matchID, EndedAtMs: endedAtMs}
	for uid, s := range a.players {
		wallet, ok := a.resolve(uid)
		if !ok { continue }
		res.Players = append(res.Players, MatchPlayer{
			Wallet: wallet, Team: s.team, Won: s.team != "" && s.team == winTeam,
			Kills: s.kills, Deaths: s.deaths, Headshots: s.headsh,
			ShotsFired: 0, ShotsHit: 0, AvgReactionMs: 300, // benign defaults (no telemetry in logs)
		})
	}
	return res
}
```

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: aggregate tests PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/aggregate.go docker/cs-web-server/src/server/oracle/aggregate_test.go
git commit -m "feat(oracle): event aggregator -> MatchResult with wallet resolver"
```

---

### Task 5: Session registry (Privy auth + index→wallet)

`TokenVerifier` abstracts Privy (real impl verifies a Privy JWT/JWKS → wallet; tests use a fake). `SessionRegistry` binds a connection `index` to a wallet after verification, and resolves uid→wallet later. For Phase 0 the uid↔index correlation is the documented wire-in seam; the registry is keyed by index and exposes a `Resolver` that the aggregator uses once that mapping is supplied.

- [ ] **Step 1: Write the failing test** — `session_test.go`
```go
package oracle

import ("errors"; "testing")

type fakeVerifier struct{ wallet string; err error }
func (f fakeVerifier) Verify(token string) (string, error) { return f.wallet, f.err }

func TestBindAndResolve(t *testing.T) {
	reg := NewSessionRegistry(fakeVerifier{wallet: "WalletX"})
	w, err := reg.Authenticate(5, "good-token")
	if err != nil || w != "WalletX" { t.Fatalf("auth: %v %s", err, w) }
	got, ok := reg.WalletForIndex(5)
	if !ok || got != "WalletX" { t.Fatalf("resolve idx: %v %s", ok, got) }
}

func TestAuthenticateRejects(t *testing.T) {
	reg := NewSessionRegistry(fakeVerifier{err: errors.New("bad token")})
	if _, err := reg.Authenticate(1, "x"); err == nil {
		t.Fatal("expected auth error to propagate")
	}
	if _, ok := reg.WalletForIndex(1); ok { t.Fatal("failed auth must not bind") }
}

func TestUnbind(t *testing.T) {
	reg := NewSessionRegistry(fakeVerifier{wallet: "W"})
	reg.Authenticate(2, "t")
	reg.Unbind(2)
	if _, ok := reg.WalletForIndex(2); ok { t.Fatal("unbind should clear") }
}
```

- [ ] **Step 2: Run & verify fail** — `go test ./...` Expected: FAIL, undefined `NewSessionRegistry`.

- [ ] **Step 3: Implement** — `session.go`
```go
package oracle

import "sync"

type TokenVerifier interface {
	// Verify validates a Privy session token and returns the associated wallet (base58).
	Verify(token string) (wallet string, err error)
}

type SessionRegistry struct {
	verifier TokenVerifier
	mu       sync.RWMutex
	byIndex  map[int]string // connection index -> wallet
}

func NewSessionRegistry(v TokenVerifier) *SessionRegistry {
	return &SessionRegistry{verifier: v, byIndex: map[int]string{}}
}

// Authenticate verifies the token and binds the connection index to the wallet.
func (r *SessionRegistry) Authenticate(index int, token string) (string, error) {
	wallet, err := r.verifier.Verify(token)
	if err != nil { return "", err }
	r.mu.Lock(); r.byIndex[index] = wallet; r.mu.Unlock()
	return wallet, nil
}

func (r *SessionRegistry) WalletForIndex(index int) (string, bool) {
	r.mu.RLock(); defer r.mu.RUnlock()
	w, ok := r.byIndex[index]; return w, ok
}

func (r *SessionRegistry) Unbind(index int) {
	r.mu.Lock(); delete(r.byIndex, index); r.mu.Unlock()
}
```

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: session tests PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/session.go docker/cs-web-server/src/server/oracle/session_test.go
git commit -m "feat(oracle): session registry + Privy TokenVerifier interface"
```

---

### Task 6: Result signer + backend POST

ed25519-sign the canonical JSON of a `MatchResult` (so the backend trusts only operator servers), and POST `{ result, signature, serverPubkey }` to the backend's results endpoint.

- [ ] **Step 1: Write the failing test** — `oracle_test.go`
```go
package oracle

import (
	"crypto/ed25519"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSignAndVerify(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	s := NewSigner(priv)
	res := MatchResult{MatchID: "m", EndedAtMs: 1, Players: []MatchPlayer{{Wallet: "W", Team: "A", Kills: 3}}}
	payload, sig := s.Sign(res)
	if !ed25519.Verify(pub, payload, sig) { t.Fatal("signature must verify over the exact payload") }
}

func TestPostSendsSignedEnvelope(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	s := NewSigner(priv)
	var got struct {
		Result       json.RawMessage `json:"result"`
		Signature    string          `json:"signature"`
		ServerPubkey string          `json:"serverPubkey"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &got)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	res := MatchResult{MatchID: "m", EndedAtMs: 1}
	if err := s.Post(srv.URL+"/results", res); err != nil { t.Fatalf("post: %v", err) }
	if got.Signature == "" || got.ServerPubkey == "" || len(got.Result) == 0 {
		t.Fatalf("envelope incomplete: %+v", got)
	}
	_ = pub
}
```

- [ ] **Step 2: Run & verify fail** — `go test ./...` Expected: FAIL, undefined `NewSigner`.

- [ ] **Step 3: Implement** — `oracle.go`
```go
package oracle

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
)

type Signer struct{ priv ed25519.PrivateKey }

func NewSigner(priv ed25519.PrivateKey) *Signer { return &Signer{priv: priv} }

// Sign returns the canonical JSON payload that was signed and its signature.
func (s *Signer) Sign(res MatchResult) (payload, sig []byte) {
	payload, _ = json.Marshal(res)
	sig = ed25519.Sign(s.priv, payload)
	return payload, sig
}

type envelope struct {
	Result       json.RawMessage `json:"result"`
	Signature    string          `json:"signature"`
	ServerPubkey string          `json:"serverPubkey"`
}

// Post signs the result and POSTs the signed envelope to url.
func (s *Signer) Post(url string, res MatchResult) error {
	payload, sig := s.Sign(res)
	env := envelope{
		Result:       payload,
		Signature:    base64.StdEncoding.EncodeToString(sig),
		ServerPubkey: base64.StdEncoding.EncodeToString(s.priv.Public().(ed25519.PublicKey)),
	}
	body, _ := json.Marshal(env)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode >= 300 { return fmt.Errorf("backend rejected result: %d", resp.StatusCode) }
	return nil
}
```

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: ALL oracle tests PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/oracle.go docker/cs-web-server/src/server/oracle/oracle_test.go
git commit -m "feat(oracle): ed25519 result signer + backend POST"
```

---

### Task 7: Wire-in seams README

- [ ] **Step 1: Create `docker/cs-web-server/src/server/oracle/README.md`**
```markdown
# oracle

Trusted-server oracle logic for the Solana hold-to-play leaderboard. Standalone, stdlib-only, unit-tested.

## Test
    go test ./...

## Pieces
- `logparse` HLDS log line -> typed events (kill/headshot/teamwin/enter)
- `aggregate` events -> MatchResult (CT->A, TERRORIST->B; benign telemetry defaults)
- `session` Privy TokenVerifier + connection-index -> wallet registry
- `oracle` ed25519 sign + POST signed envelope to the reward backend

## Wire-in seams (in ../sfu.go / ../main.go — done when integrating, not here)
1. **Auth gate**: in `websocketHandler`, read the Privy token (query param `?token=` or first WS message),
   call `registry.Authenticate(index, token)`; on error, close the socket. On disconnect call `registry.Unbind(index)`.
2. **uid <-> index correlation**: when the engine reports a player connect from a connection's synthetic addr
   (ip[0]==index), record uid->index so `Resolver(uid)` = `registry.WalletForIndex(index)`.
3. **Engine log tap**: feed the embedded engine's HLDS log lines to `ParseLine`; push events into the
   per-match `Aggregator`. (Exact tap depends on the goxash3d-fwgs engine API — TODO at integration.)
4. **On match end**: `signer.Post(backendURL+"/results", agg.Finalize(nowMs))`.
5. **Demo recording**: issue the engine console `record <matchId>` at match start and store the .dem
   (engine-console dependent; integration concern).

## Deferred
Richer per-player telemetry (accuracy/reaction) via an AMXX plugin; the backend `/results` HTTP endpoint
that verifies the signature against an allowlist of operator server pubkeys.
```

- [ ] **Step 2: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/README.md
git commit -m "docs(oracle): wire-in seams for sfu.go/main.go integration"
```

---

## Self-Review

**Spec coverage (this plan = spec §4 Go server "sole result oracle", §5 wallet↔session binding, §6 result feeding the backend, §10 operator-signed results):**
- §5 "auth shifts to wallet↔session binding" → Task 5 `SessionRegistry` + `TokenVerifier` (Privy). ✅
- §4 "Go server is the sole result oracle" → Tasks 3+4 turn engine logs into an authoritative `MatchResult`. ✅
- §10/§6 "reward-eligible matches only from operator servers; results signed" → Task 6 ed25519 sign + envelope with serverPubkey. ✅
- §6 result JSON consumed by the backend → Task 2 types match `services/reward-backend/src/types.ts`. ✅
- Documented wire-in seams (Task 7) cover the parts that touch the upstream engine API and `sfu.go` — kept out of the unit-tested core deliberately, since modifying the CGO/WebRTC build is out of scope for this plan.

**Placeholder scan:** none in the code. The README lists integration TODOs (engine log tap, demo recording) — these are genuine deferred integration seams, explicitly scoped out, not placeholders in shipped code.

**Type consistency:** `MatchResult`/`MatchPlayer` JSON tags (`matchId`, `endedAtMs`, `wallet`, `team`, `won`, `kills`, `deaths`, `headshots`, `shotsFired`, `shotsHit`, `avgReactionMs`) match the backend's TS interface exactly. `Event` interface + `KillEvent`/`HeadshotEvent`/`TeamWinEvent`/`EnterEvent` used identically in `logparse.go`, its test, and `aggregate.go`. `Resolver func(uid int)(string,bool)` matches between `aggregate.go` and the `SessionRegistry.WalletForIndex` shape (adapter is a one-liner at wire-in). Team mapping CT→A / TERRORIST→B consistent in `aggregate.go`.

**Known follow-ups (not blockers):** real Privy JWT/JWKS verification implementation of `TokenVerifier`; the backend `/results` endpoint + operator-pubkey allowlist (backend HTTP plan); the engine log tap + uid↔index correlation in `sfu.go`; demo recording; AMXX telemetry for accuracy/reaction.
