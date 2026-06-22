package oracle

import "testing"

func TestParseKill(t *testing.T) {
	line := `L 06/22/2026 - 10:00:01: "Alice<2><STEAM_0:1:11><CT>" killed "Bob<3><STEAM_0:1:22><TERRORIST>" with "ak47"`
	ev, ok := ParseLine(line)
	if !ok {
		t.Fatal("expected parse ok")
	}
	k, isKill := ev.(KillEvent)
	if !isKill {
		t.Fatalf("expected KillEvent, got %T", ev)
	}
	if k.KillerUID != 2 || k.VictimUID != 3 || k.KillerTeam != "CT" || k.VictimTeam != "TERRORIST" {
		t.Fatalf("bad kill parse: %+v", k)
	}
}

func TestParseHeadshot(t *testing.T) {
	line := `L 06/22/2026 - 10:00:01: "Alice<2><STEAM_0:1:11><CT>" triggered "headshot"`
	ev, ok := ParseLine(line)
	if !ok {
		t.Fatal("ok")
	}
	h, is := ev.(HeadshotEvent)
	if !is || h.UID != 2 {
		t.Fatalf("bad headshot: %+v", ev)
	}
}

func TestParseTeamWin(t *testing.T) {
	line := `L 06/22/2026 - 10:05:00: Team "CT" triggered "CTs_Win" (CT "3") (T "1")`
	ev, ok := ParseLine(line)
	if !ok {
		t.Fatal("ok")
	}
	w, is := ev.(TeamWinEvent)
	if !is || w.Team != "CT" {
		t.Fatalf("bad teamwin: %+v", ev)
	}
}

func TestParseEntered(t *testing.T) {
	line := `L 06/22/2026 - 10:00:00: "Alice<2><STEAM_0:1:11><>" entered the game`
	ev, ok := ParseLine(line)
	if !ok {
		t.Fatal("ok")
	}
	c, is := ev.(EnterEvent)
	if !is || c.UID != 2 || c.Name != "Alice" {
		t.Fatalf("bad enter: %+v", ev)
	}
}

func TestParseUnknownReturnsFalse(t *testing.T) {
	if _, ok := ParseLine(`L 06/22/2026 - 10:00:00: some unrelated line`); ok {
		t.Fatal("unknown line must return ok=false")
	}
}
