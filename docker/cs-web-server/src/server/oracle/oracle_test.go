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
	if !ed25519.Verify(pub, payload, sig) {
		t.Fatal("signature must verify over the exact payload")
	}
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
	if err := s.Post(srv.URL+"/results", res); err != nil {
		t.Fatalf("post: %v", err)
	}
	if got.Signature == "" || got.ServerPubkey == "" || len(got.Result) == 0 {
		t.Fatalf("envelope incomplete: %+v", got)
	}
	_ = pub
}
