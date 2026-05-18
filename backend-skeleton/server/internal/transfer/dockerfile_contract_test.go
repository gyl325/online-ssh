package transfer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDockerfilePreservesWritableTransferTempDirInScratchRuntime(t *testing.T) {
	dockerfile := readRepoFile(t, "Dockerfile")
	normalized := strings.Join(strings.Fields(dockerfile), " ")

	if !strings.Contains(dockerfile, "ENV TMPDIR=/tmp") {
		t.Fatalf("Dockerfile must keep TMPDIR pointed at /tmp for transfer artifacts")
	}
	if !strings.Contains(dockerfile, "/runtime/tmp/online-ssh-transfers") {
		t.Fatalf("Dockerfile must create a non-empty transfer temp dir so scratch images preserve /tmp")
	}
	if !strings.Contains(normalized, "chown 65532:65532 /runtime/tmp/online-ssh-transfers") {
		t.Fatalf("Dockerfile must make the transfer temp dir owned by the non-root runtime user")
	}
	if !strings.Contains(normalized, "chmod 0700 /runtime/tmp/online-ssh-transfers") {
		t.Fatalf("Dockerfile must keep the transfer temp dir private to the app user")
	}
}

func readRepoFile(t *testing.T, name string) string {
	t.Helper()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	for {
		candidate := filepath.Join(dir, name)
		content, readErr := os.ReadFile(candidate)
		if readErr == nil {
			return string(content)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("find %s from %s: %v", name, dir, readErr)
		}
		dir = parent
	}
}
