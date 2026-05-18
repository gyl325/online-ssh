package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/config"
	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/db"
)

type keyStatusRow struct {
	KeyVersion int
	Count      int
	Configured bool
	Active     bool
}

type keyStatusReport struct {
	ActiveKeyVersion             int
	ConfiguredKeyVersions        []int
	Rows                         []keyStatusRow
	MissingConfiguredKeyVersions []int
	OldKeyVersionsWithRecords    []int
	TotalCredentials             int
}

func main() {
	if len(os.Args) != 2 || os.Args[1] != "key-status" {
		fmt.Fprintln(os.Stderr, "usage: credential key-status")
		os.Exit(2)
	}

	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	encryptor, err := credential.NewKeyRingEncryptorFromConfig(
		cfg.CredentialMasterKey,
		cfg.CredentialKeyRing,
		cfg.CredentialActiveKeyVersion,
	)
	if err != nil {
		log.Fatalf("load credential key ring failed: %v", err)
	}

	database, err := db.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect database failed: %v", err)
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	repo := credential.NewPostgresRepository(database)
	counts, err := repo.CountByKeyVersion(ctx)
	if err != nil {
		log.Fatalf("read credential key status failed: %v", err)
	}

	report := buildKeyStatusReport(counts, encryptor)
	writeKeyStatus(os.Stdout, report)
	if len(report.MissingConfiguredKeyVersions) > 0 {
		os.Exit(1)
	}
}

func buildKeyStatusReport(counts []credential.KeyVersionCount, encryptor credential.VersionedEncryptor) keyStatusReport {
	countsByVersion := make(map[int]int, len(counts))
	versions := make(map[int]struct{})
	total := 0
	for _, count := range counts {
		countsByVersion[count.KeyVersion] = count.Count
		versions[count.KeyVersion] = struct{}{}
		total += count.Count
	}

	configuredVersions := encryptor.ConfiguredKeyVersions()
	for _, version := range configuredVersions {
		versions[version] = struct{}{}
	}

	orderedVersions := make([]int, 0, len(versions))
	for version := range versions {
		orderedVersions = append(orderedVersions, version)
	}
	sort.Ints(orderedVersions)

	report := keyStatusReport{
		ActiveKeyVersion:      encryptor.ActiveKeyVersion(),
		ConfiguredKeyVersions: configuredVersions,
		TotalCredentials:      total,
	}

	for _, version := range orderedVersions {
		count := countsByVersion[version]
		configured := encryptor.IsKeyVersionConfigured(version)
		row := keyStatusRow{
			KeyVersion: version,
			Count:      count,
			Configured: configured,
			Active:     version == report.ActiveKeyVersion,
		}
		report.Rows = append(report.Rows, row)
		if count > 0 && !configured {
			report.MissingConfiguredKeyVersions = append(report.MissingConfiguredKeyVersions, version)
		}
		if count > 0 && version != report.ActiveKeyVersion {
			report.OldKeyVersionsWithRecords = append(report.OldKeyVersionsWithRecords, version)
		}
	}

	return report
}

func writeKeyStatus(w io.Writer, report keyStatusReport) {
	fmt.Fprintf(w, "active_key_version: %d\n", report.ActiveKeyVersion)
	fmt.Fprintf(w, "configured_key_versions: %s\n", formatIntList(report.ConfiguredKeyVersions))
	fmt.Fprintf(w, "total_credentials: %d\n\n", report.TotalCredentials)
	fmt.Fprintln(w, "key_version\tcredentials\tconfigured\tactive")
	for _, row := range report.Rows {
		fmt.Fprintf(
			w,
			"%d\t%d\t%s\t%s\n",
			row.KeyVersion,
			row.Count,
			yesNo(row.Configured),
			yesNo(row.Active),
		)
	}
	fmt.Fprintf(w, "\nmissing_configured_key_versions: %s\n", formatIntList(report.MissingConfiguredKeyVersions))
	fmt.Fprintf(w, "old_key_versions_with_credentials: %s\n", formatIntList(report.OldKeyVersionsWithRecords))
}

func formatIntList(values []int) string {
	if len(values) == 0 {
		return "none"
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.Itoa(value))
	}
	return strings.Join(parts, ",")
}

func yesNo(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}
