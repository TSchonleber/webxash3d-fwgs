package oracle

import "testing"

func TestAggregate(t *testing.T) {
	resolver := func(uid int) (string, bool) {
		m := map[int]string{2: "Wallet_Alice", 3: "Wallet_Bob"}
		w, ok := m[uid]
		return w, ok
	}
	agg := NewAggregator("match-1", resolver)
	agg.Add(EnterEvent{UID: 2, Name: "Alice"})
	agg.Add(EnterEvent{UID: 3, Name: "Bob"})
	agg.Add(KillEvent{KillerUID: 2, KillerTeam: "CT", VictimUID: 3, VictimTeam: "TERRORIST", Weapon: "ak47"})
	agg.Add(HeadshotEvent{UID: 2})
	agg.Add(TeamWinEvent{Team: "CT"})
	res := agg.Finalize(1_000_000)

	if res.MatchID != "match-1" || res.EndedAtMs != 1_000_000 {
		t.Fatal("header")
	}
	if len(res.Players) != 2 {
		t.Fatalf("want 2 players, got %d", len(res.Players))
	}
	var alice *MatchPlayer
	for i := range res.Players {
		if res.Players[i].Wallet == "Wallet_Alice" {
			alice = &res.Players[i]
		}
	}
	if alice == nil {
		t.Fatal("alice missing")
	}
	if alice.Kills != 1 || alice.Headshots != 1 || alice.Team != "A" || !alice.Won {
		t.Fatalf("alice: %+v", *alice)
	}
	if alice.AvgReactionMs != 300 {
		t.Fatalf("expected benign reaction default, got %d", alice.AvgReactionMs)
	}
}

func TestAggregateDropsUnmappedUID(t *testing.T) {
	resolver := func(uid int) (string, bool) { return "", false } // nobody mapped
	agg := NewAggregator("m", resolver)
	agg.Add(KillEvent{KillerUID: 2, KillerTeam: "CT", VictimUID: 3, VictimTeam: "TERRORIST"})
	res := agg.Finalize(1)
	if len(res.Players) != 0 {
		t.Fatalf("unmapped uids must be dropped, got %d", len(res.Players))
	}
}
