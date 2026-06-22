package oracle

import (
	"errors"
	"testing"
)

type fakeVerifier struct {
	wallet string
	err    error
}

func (f fakeVerifier) Verify(token string) (string, error) { return f.wallet, f.err }

func TestBindAndResolve(t *testing.T) {
	reg := NewSessionRegistry(fakeVerifier{wallet: "WalletX"})
	w, err := reg.Authenticate(5, "good-token")
	if err != nil || w != "WalletX" {
		t.Fatalf("auth: %v %s", err, w)
	}
	got, ok := reg.WalletForIndex(5)
	if !ok || got != "WalletX" {
		t.Fatalf("resolve idx: %v %s", ok, got)
	}
}

func TestAuthenticateRejects(t *testing.T) {
	reg := NewSessionRegistry(fakeVerifier{err: errors.New("bad token")})
	if _, err := reg.Authenticate(1, "x"); err == nil {
		t.Fatal("expected auth error to propagate")
	}
	if _, ok := reg.WalletForIndex(1); ok {
		t.Fatal("failed auth must not bind")
	}
}

func TestUnbind(t *testing.T) {
	reg := NewSessionRegistry(fakeVerifier{wallet: "W"})
	reg.Authenticate(2, "t")
	reg.Unbind(2)
	if _, ok := reg.WalletForIndex(2); ok {
		t.Fatal("unbind should clear")
	}
}
