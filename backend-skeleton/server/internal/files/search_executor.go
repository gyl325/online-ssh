package files

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
)

type remoteSearchClient interface {
	ReadDir(p string) ([]os.FileInfo, error)
}

type searchDirectory struct {
	path  string
	depth int
}

func (s *Service) searchRemoteBFS(ctx context.Context, client remoteSearchClient, task model.FileSearchTask) (SearchTaskProgress, error) {
	progress := SearchTaskProgress{Warnings: make([]SearchTaskWarning, 0)}
	if client == nil {
		return progress, ErrInvalidInput
	}

	keyword := strings.ToLower(strings.TrimSpace(task.Keyword))
	queue := []searchDirectory{{path: task.BasePath, depth: 0}}
	batch := make([]model.FileSearchResult, 0, searchResultBatchSize)

	flushBatch := func() error {
		if len(batch) == 0 || s.searchRepo == nil {
			batch = batch[:0]
			return nil
		}
		if err := s.searchRepo.InsertSearchResults(ctx, task.ID, batch); err != nil {
			return err
		}
		batch = batch[:0]
		return nil
	}

	for len(queue) > 0 {
		select {
		case <-ctx.Done():
			_ = flushBatch()
			return progress, ctx.Err()
		default:
		}

		current := queue[0]
		queue = queue[1:]
		items, err := client.ReadDir(current.path)
		if err != nil {
			if current.path == task.BasePath {
				return progress, fmt.Errorf("read search base directory: %w", err)
			}
			progress.SkippedErrorsCount++
			if len(progress.Warnings) < searchMaxWarnings {
				progress.Warnings = append(progress.Warnings, SearchTaskWarning{Path: current.path, Message: err.Error()})
			}
			continue
		}
		progress.ScannedDirs++

		sort.Slice(items, func(i, j int) bool {
			leftDir := items[i].IsDir()
			rightDir := items[j].IsDir()
			if leftDir != rightDir {
				return leftDir
			}
			return strings.ToLower(items[i].Name()) < strings.ToLower(items[j].Name())
		})

		for _, item := range items {
			select {
			case <-ctx.Done():
				_ = flushBatch()
				return progress, ctx.Err()
			default:
			}

			progress.ScannedEntries++
			if progress.ScannedEntries >= task.MaxScannedEntries {
				progress.LimitReached = true
			}

			if strings.HasPrefix(item.Name(), ".") && !task.IncludeHidden {
				if progress.LimitReached {
					break
				}
				continue
			}

			entry := fileEntryFromInfo(current.path, item)
			if searchTaskMatches(entry, keyword, task.MatchMode) {
				progress.MatchedEntries++
				batch = append(batch, fileSearchResultFromEntry(task.ID, progress.MatchedEntries, entry))
				if len(batch) >= searchResultBatchSize {
					if err := flushBatch(); err != nil {
						return progress, err
					}
				}
				if progress.MatchedEntries >= task.MaxResults {
					progress.LimitReached = true
					break
				}
			}

			if task.Recursive && item.IsDir() && current.depth < task.MaxDepth {
				queue = append(queue, searchDirectory{path: entry.Path, depth: current.depth + 1})
			}

			if s.searchRepo != nil && progress.ScannedEntries%searchProgressEveryEntries == 0 {
				if err := s.searchRepo.UpdateSearchTaskProgress(ctx, task.ID, progress); err != nil {
					return progress, err
				}
			}
			if progress.LimitReached {
				break
			}
		}
		if progress.LimitReached {
			break
		}
	}

	if err := flushBatch(); err != nil {
		return progress, err
	}
	if s.searchRepo != nil {
		if err := s.searchRepo.UpdateSearchTaskProgress(ctx, task.ID, progress); err != nil {
			return progress, err
		}
	}
	return progress, nil
}
