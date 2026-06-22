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
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", false
	}
	var body struct {
		Wallet string `json:"wallet"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", false
	}
	return body.Wallet, body.Wallet != ""
}
