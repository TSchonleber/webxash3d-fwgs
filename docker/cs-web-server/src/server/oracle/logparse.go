package oracle

import (
	"regexp"
	"strconv"
)

type Event interface{ isEvent() }

type KillEvent struct {
	KillerUID, VictimUID   int
	KillerName, VictimName string
	KillerTeam, VictimTeam string
	Weapon                 string
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
			KillerUID: atoi(m[2]), KillerName: m[1], KillerTeam: m[3],
			VictimUID: atoi(m[5]), VictimName: m[4], VictimTeam: m[6], Weapon: m[7],
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
