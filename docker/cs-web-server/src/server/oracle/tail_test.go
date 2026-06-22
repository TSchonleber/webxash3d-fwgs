package oracle

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTailReadsAppendedLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.log")
	os.WriteFile(path, []byte("line1\n"), 0644)

	lines := make(chan string, 8)
	stop := make(chan struct{})
	go TailFile(path, func(l string) { lines <- l }, stop)

	time.Sleep(50 * time.Millisecond)
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	f.WriteString("line2\nline3\n")
	f.Close()

	got := []string{}
	timeout := time.After(2 * time.Second)
	for len(got) < 2 {
		select {
		case l := <-lines:
			got = append(got, l)
		case <-timeout:
			t.Fatalf("timeout, got %v", got)
		}
	}
	close(stop)
	if got[0] != "line2" || got[1] != "line3" {
		t.Fatalf("appended lines: %v", got)
	}
}
