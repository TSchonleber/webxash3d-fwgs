package oracle

import "sync"

type TokenVerifier interface {
	// Verify validates a Privy session token and returns the associated wallet (base58).
	Verify(token string) (wallet string, err error)
}

type SessionRegistry struct {
	verifier TokenVerifier
	mu       sync.RWMutex
	byIndex  map[int]string // connection index -> wallet
}

func NewSessionRegistry(v TokenVerifier) *SessionRegistry {
	return &SessionRegistry{verifier: v, byIndex: map[int]string{}}
}

// Authenticate verifies the token and binds the connection index to the wallet.
func (r *SessionRegistry) Authenticate(index int, token string) (string, error) {
	wallet, err := r.verifier.Verify(token)
	if err != nil {
		return "", err
	}
	r.mu.Lock()
	r.byIndex[index] = wallet
	r.mu.Unlock()
	return wallet, nil
}

func (r *SessionRegistry) WalletForIndex(index int) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	w, ok := r.byIndex[index]
	return w, ok
}

func (r *SessionRegistry) Unbind(index int) {
	r.mu.Lock()
	delete(r.byIndex, index)
	r.mu.Unlock()
}
