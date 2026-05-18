package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/credential"
)

func TestBuildKeyStatusReport(t *testing.T) {
	encryptor, err := credential.NewKeyRingEncryptor(map[int]string{
		1: "old-master",
		2: "new-master",
	}, 2)
	if err != nil {
		t.Fatalf("build key ring: %v", err)
	}

	report := buildKeyStatusReport([]credential.KeyVersionCount{
		{KeyVersion: 1, Count: 2},
		{KeyVersion: 3, Count: 1},
	}, encryptor)

	if report.ActiveKeyVersion != 2 {
		t.Fatalf("expected active version 2, got %d", report.ActiveKeyVersion)
	}
	if report.TotalCredentials != 3 {
		t.Fatalf("expected total 3, got %d", report.TotalCredentials)
	}
	if len(report.MissingConfiguredKeyVersions) != 1 || report.MissingConfiguredKeyVersions[0] != 3 {
		t.Fatalf("expected missing version 3, got %#v", report.MissingConfiguredKeyVersions)
	}
	if len(report.OldKeyVersionsWithRecords) != 2 || report.OldKeyVersionsWithRecords[0] != 1 || report.OldKeyVersionsWithRecords[1] != 3 {
		t.Fatalf("unexpected old key versions: %#v", report.OldKeyVersionsWithRecords)
	}

	var output bytes.Buffer
	writeKeyStatus(&output, report)
	text := output.String()
	for _, expected := range []string{
		"active_key_version: 2",
		"configured_key_versions: 1,2",
		"total_credentials: 3",
		"1\t2\tyes\tno",
		"2\t0\tyes\tyes",
		"3\t1\tno\tno",
		"missing_configured_key_versions: 3",
		"old_key_versions_with_credentials: 1,3",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected output to contain %q, got:\n%s", expected, text)
		}
	}
}
