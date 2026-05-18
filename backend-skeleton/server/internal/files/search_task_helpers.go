package files

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func normalizeSearchTaskInput(input CreateSearchTaskInput) (model.FileSearchTask, error) {
	userID := strings.TrimSpace(input.UserID)
	hostID := strings.TrimSpace(input.HostID)
	basePath, err := cleanRemotePath(input.BasePath, remotePathOptions{})
	keyword := strings.TrimSpace(input.Keyword)
	if err != nil || userID == "" || hostID == "" || keyword == "" {
		return model.FileSearchTask{}, ErrInvalidInput
	}
	if utf8.RuneCountInString(keyword) < 2 || utf8.RuneCountInString(keyword) > maxSearchKeywordLength {
		return model.FileSearchTask{}, ErrInvalidInput
	}

	matchMode := strings.TrimSpace(input.MatchMode)
	if matchMode == "" {
		matchMode = "name"
	}
	if matchMode != "name" && matchMode != "path" {
		return model.FileSearchTask{}, ErrInvalidInput
	}

	recursive := true
	if input.Recursive != nil {
		recursive = *input.Recursive
	}

	maxDepth := input.MaxDepth
	if maxDepth == 0 {
		maxDepth = defaultSearchMaxDepth
	}
	if maxDepth < 0 || maxDepth > maxSearchMaxDepth {
		return model.FileSearchTask{}, ErrInvalidInput
	}

	maxResults := input.MaxResults
	if maxResults == 0 {
		maxResults = defaultSearchMaxResults
	}
	if maxResults < 1 || maxResults > maxSearchMaxResults {
		return model.FileSearchTask{}, ErrInvalidInput
	}

	maxScannedEntries := input.MaxScannedEntries
	if maxScannedEntries == 0 {
		maxScannedEntries = defaultSearchMaxScannedEntries
	}
	if maxScannedEntries < 1 || maxScannedEntries > maxSearchMaxScannedEntries {
		return model.FileSearchTask{}, ErrInvalidInput
	}

	timeoutSeconds := input.TimeoutSeconds
	if timeoutSeconds == 0 {
		timeoutSeconds = defaultSearchTimeoutSeconds
	}
	if timeoutSeconds < 1 || timeoutSeconds > maxSearchTimeoutSeconds {
		return model.FileSearchTask{}, ErrInvalidInput
	}

	return model.FileSearchTask{
		UserID:            userID,
		HostID:            hostID,
		BasePath:          basePath,
		Keyword:           keyword,
		MatchMode:         matchMode,
		Recursive:         recursive,
		IncludeHidden:     input.IncludeHidden,
		MaxDepth:          maxDepth,
		MaxResults:        maxResults,
		MaxScannedEntries: maxScannedEntries,
		TimeoutSeconds:    timeoutSeconds,
		Status:            string(model.FileSearchTaskStatusPending),
		ExpiresAt:         time.Now().Add(defaultSearchTaskTTL),
	}, nil
}

func searchTaskMatches(entry FileEntry, keyword, matchMode string) bool {
	name := strings.ToLower(entry.Name)
	if strings.Contains(name, keyword) {
		return true
	}
	return matchMode == "path" && strings.Contains(strings.ToLower(entry.Path), keyword)
}

func fileSearchResultFromEntry(taskID string, rank int, entry FileEntry) model.FileSearchResult {
	return model.FileSearchResult{
		TaskID:      taskID,
		Rank:        rank,
		Name:        entry.Name,
		Path:        entry.Path,
		EntryType:   entry.EntryType,
		SizeBytes:   entry.SizeBytes,
		Permissions: entry.Permissions,
		Owner:       entry.Owner,
		Group:       entry.Group,
		ModifiedAt:  entry.ModifiedAt,
		IsHidden:    entry.IsHidden,
	}
}
