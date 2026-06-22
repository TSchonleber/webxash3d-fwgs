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
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("backend rejected result: %d", resp.StatusCode)
	}
	return nil
}
