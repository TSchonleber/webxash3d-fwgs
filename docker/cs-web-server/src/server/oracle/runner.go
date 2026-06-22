package oracle

// nameResolver maps an in-game (uid,name) to a wallet. ok=false drops the player.
type nameResolver func(uid int, name string) (string, bool)
type poster func(res MatchResult) error

type MatchRunner struct {
	resolve nameResolver
	post    poster
	names   map[int]string // uid -> latest name
	agg     *Aggregator
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
		if !ok {
			return "", false
		}
		return r.resolve(uid, name)
	})
}

// Feed parses one log line and records identity + stats.
func (r *MatchRunner) Feed(line string) {
	ev, ok := ParseLine(line)
	if !ok {
		return
	}
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
