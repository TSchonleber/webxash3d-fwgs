package oracle

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegistryClientResolve(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/resolve/neo" {
			w.Write([]byte(`{"wallet":"WalletNeo"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()

	c := NewRegistryClient(srv.URL)
	w, ok := c.Resolve("neo")
	if !ok || w != "WalletNeo" {
		t.Fatalf("resolve neo: %v %s", ok, w)
	}
	if _, ok := c.Resolve("ghost"); ok {
		t.Fatal("ghost must be unresolved")
	}
}
