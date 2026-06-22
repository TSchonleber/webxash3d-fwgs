package oracle

import (
	"bufio"
	"io"
	"os"
	"strings"
	"time"
)

// TailFile follows a file from its current end, calling onLine for each newly appended line
// until stop is closed. New lines only (existing content is skipped).
func TailFile(path string, onLine func(string), stop <-chan struct{}) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	f.Seek(0, io.SeekEnd)
	reader := bufio.NewReader(f)
	for {
		select {
		case <-stop:
			return nil
		default:
		}
		line, err := reader.ReadString('\n')
		if err == io.EOF {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		if err != nil {
			return err
		}
		onLine(strings.TrimRight(line, "\r\n"))
	}
}
