package oracle

import "testing"

func TestRunnerFinalizePostsResolvedResult(t *testing.T) {
	posted := []MatchResult{}
	r := NewMatchRunner(
		func(uid int, name string) (string, bool) { // resolver: name -> wallet
			m := map[string]string{"alice": "Wa", "bob": "Wb"}
			w, ok := m[name]
			return w, ok
		},
		func(res MatchResult) error { posted = append(posted, res); return nil }, // poster
	)
	r.Feed(`L d: "alice<2><id><CT>" entered the game`)
	r.Feed(`L d: "bob<3><id><TERRORIST>" entered the game`)
	r.Feed(`L d: "alice<2><id><CT>" killed "bob<3><id><TERRORIST>" with "ak47"`)
	r.Feed(`L d: "alice<2><id><CT>" triggered "headshot"`)
	r.Feed(`L d: Team "CT" triggered "CTs_Win" (CT "1") (T "0")`)
	r.Finalize("match-9", 1234)

	if len(posted) != 1 {
		t.Fatalf("want 1 posted result, got %d", len(posted))
	}
	res := posted[0]
	if res.MatchID != "match-9" || res.EndedAtMs != 1234 {
		t.Fatal("header")
	}
	var alice *MatchPlayer
	for i := range res.Players {
		if res.Players[i].Wallet == "Wa" {
			alice = &res.Players[i]
		}
	}
	if alice == nil || alice.Kills != 1 || alice.Headshots != 1 || !alice.Won {
		t.Fatalf("alice: %+v", res.Players)
	}
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
	if posted != 2 {
		t.Fatalf("want 2 posts, got %d", posted)
	}
}
