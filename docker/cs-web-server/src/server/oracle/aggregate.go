package oracle

// Resolver maps an in-game userid to a wallet (base58). ok=false drops the player.
type Resolver func(uid int) (string, bool)

type stat struct {
	team                  string
	kills, deaths, headsh int
	streak, bestStreak    int // current kills-without-dying run, and the max this match
}

type Aggregator struct {
	matchID   string
	resolve   Resolver
	players   map[int]*stat  // uid -> stat
	roundWins map[string]int // "A"/"B" -> wins
}

func NewAggregator(matchID string, r Resolver) *Aggregator {
	return &Aggregator{matchID: matchID, resolve: r, players: map[int]*stat{}, roundWins: map[string]int{}}
}

func teamCode(hlds string) string {
	if hlds == "CT" {
		return "A"
	}
	return "B" // TERRORIST and anything else
}

func (a *Aggregator) ensure(uid int, team string) *stat {
	s := a.players[uid]
	if s == nil {
		s = &stat{}
		a.players[uid] = s
	}
	if team != "" {
		s.team = teamCode(team)
	}
	return s
}

func (a *Aggregator) Add(ev Event) {
	switch e := ev.(type) {
	case EnterEvent:
		a.ensure(e.UID, "")
	case KillEvent:
		ks := a.ensure(e.KillerUID, e.KillerTeam)
		ks.kills++
		ks.streak++
		if ks.streak > ks.bestStreak {
			ks.bestStreak = ks.streak
		}
		vs := a.ensure(e.VictimUID, e.VictimTeam)
		vs.deaths++
		vs.streak = 0
	case HeadshotEvent:
		a.ensure(e.UID, "").headsh++
	case TeamWinEvent:
		a.roundWins[teamCode(e.Team)]++
	}
}

func (a *Aggregator) Finalize(endedAtMs int64) MatchResult {
	winTeam := ""
	if a.roundWins["A"] != a.roundWins["B"] {
		if a.roundWins["A"] > a.roundWins["B"] {
			winTeam = "A"
		} else {
			winTeam = "B"
		}
	}
	res := MatchResult{MatchID: a.matchID, EndedAtMs: endedAtMs}
	for uid, s := range a.players {
		wallet, ok := a.resolve(uid)
		if !ok {
			continue
		}
		res.Players = append(res.Players, MatchPlayer{
			Wallet: wallet, Team: s.team, Won: s.team != "" && s.team == winTeam,
			Kills: s.kills, Deaths: s.deaths, BestStreak: s.bestStreak, Headshots: s.headsh,
			ShotsFired: 0, ShotsHit: 0, AvgReactionMs: 300, // benign defaults (no telemetry in logs)
		})
	}
	return res
}
