package oracle

// MatchPlayer mirrors services/reward-backend/src/types.ts MatchPlayer (JSON field names must match).
type MatchPlayer struct {
	Wallet        string `json:"wallet"`
	Team          string `json:"team"` // "A" or "B"
	Won           bool   `json:"won"`
	Kills         int    `json:"kills"`
	Deaths        int    `json:"deaths"`
	BestStreak    int    `json:"bestStreak"` // longest kills-without-dying streak in the match
	Headshots     int    `json:"headshots"`
	ShotsFired    int    `json:"shotsFired"`
	ShotsHit      int    `json:"shotsHit"`
	AvgReactionMs int    `json:"avgReactionMs"`
}

// MatchResult mirrors services/reward-backend/src/types.ts MatchResult.
type MatchResult struct {
	MatchID   string        `json:"matchId"`
	EndedAtMs int64         `json:"endedAtMs"`
	Players   []MatchPlayer `json:"players"`
}
