package host

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type HostMetrics struct {
	HostID             string         `json:"host_id"`
	CollectedAt        time.Time      `json:"collected_at"`
	CPUUsagePercent    *float64       `json:"cpu_usage_percent,omitempty"`
	MemoryUsagePercent *float64       `json:"memory_usage_percent,omitempty"`
	MemoryUsedBytes    *int64         `json:"memory_used_bytes,omitempty"`
	MemoryTotalBytes   *int64         `json:"memory_total_bytes,omitempty"`
	DiskUsagePercent   *float64       `json:"disk_usage_percent,omitempty"`
	DiskUsedBytes      *int64         `json:"disk_used_bytes,omitempty"`
	DiskTotalBytes     *int64         `json:"disk_total_bytes,omitempty"`
	UptimeSeconds      *int64         `json:"uptime_seconds,omitempty"`
	GPUUsagePercent    *float64       `json:"gpu_usage_percent,omitempty"`
	System             HostSystemInfo `json:"system"`
	SSH                HostSSHInfo    `json:"ssh"`
	Login              HostLoginInfo  `json:"login"`
}

type HostSystemInfo struct {
	Hostname string `json:"hostname"`
	OSName   string `json:"os_name"`
	Kernel   string `json:"kernel"`
}

type HostSSHInfo struct {
	User   string `json:"user"`
	Client string `json:"client"`
}

type HostLoginInfo struct {
	ActiveLoginCount *int64   `json:"active_login_count,omitempty"`
	LastLogin        string   `json:"last_login"`
	RecentLogins     []string `json:"recent_logins,omitempty"`
}

const hostMetricsCommand = `if [ -r /proc/stat ]; then
  read cpu user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
  total1=$((user + nice + system + idle + iowait + irq + softirq + steal))
  idle1=$((idle + iowait))
  sleep 0.2
  read cpu user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
  total2=$((user + nice + system + idle + iowait + irq + softirq + steal))
  idle2=$((idle + iowait))
  awk -v total_delta="$((total2 - total1))" -v idle_delta="$((idle2 - idle1))" 'BEGIN {
    if (total_delta > 0) {
      printf "CPU_USAGE_PERCENT=%.1f\n", (total_delta - idle_delta) * 100 / total_delta
    } else {
      print "CPU_USAGE_PERCENT="
    }
  }'
else
  echo "CPU_USAGE_PERCENT="
fi

if [ -r /proc/meminfo ]; then
  awk '
    /^MemTotal:/ { total=$2 * 1024 }
    /^MemAvailable:/ { available=$2 * 1024 }
    END {
      if (total > 0) {
        used=total-available
        printf "MEMORY_USAGE_PERCENT=%.1f\n", used * 100 / total
        printf "MEMORY_USED_BYTES=%.0f\n", used
        printf "MEMORY_TOTAL_BYTES=%.0f\n", total
      } else {
        print "MEMORY_USAGE_PERCENT="
        print "MEMORY_USED_BYTES="
        print "MEMORY_TOTAL_BYTES="
      }
    }
  ' /proc/meminfo
else
  echo "MEMORY_USAGE_PERCENT="
  echo "MEMORY_USED_BYTES="
  echo "MEMORY_TOTAL_BYTES="
fi

df -PB1 / 2>/dev/null | awk 'NR==2 {
  used=$3
  total=$2
  percent=$5
  sub(/%/, "", percent)
  print "DISK_USAGE_PERCENT=" percent
  print "DISK_USED_BYTES=" used
  print "DISK_TOTAL_BYTES=" total
}'

if [ -r /proc/uptime ]; then
  awk '{ printf "UPTIME_SECONDS=%.0f\n", $1 }' /proc/uptime
else
  echo "UPTIME_SECONDS="
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_usage="$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -n 1 | tr -dc '0-9.')"
  echo "GPU_USAGE_PERCENT=$gpu_usage"
else
  echo "GPU_USAGE_PERCENT="
fi

printf 'HOSTNAME=%s\n' "$(hostname 2>/dev/null)"
if [ -r /etc/os-release ]; then
  os_name="$(awk -F= '/^PRETTY_NAME=/{gsub(/^"|"$/, "", $2); print $2; exit}' /etc/os-release)"
  if [ -z "$os_name" ]; then
    os_name="$(uname -s 2>/dev/null)"
  fi
else
  os_name="$(uname -s 2>/dev/null)"
fi
printf 'OS_NAME=%s\n' "$os_name"
printf 'KERNEL=%s\n' "$(uname -r 2>/dev/null)"
printf 'SSH_USER=%s\n' "${USER:-$(whoami 2>/dev/null)}"
printf 'SSH_CLIENT=%s\n' "$SSH_CLIENT"
login_user="${USER:-$(whoami 2>/dev/null)}"
active_login_count="$(who 2>/dev/null | wc -l | tr -d ' ')"
printf 'ACTIVE_LOGIN_COUNT=%s\n' "$active_login_count"
last_login="$(last -n 1 "$login_user" 2>/dev/null | head -n 1)"
printf 'LAST_LOGIN=%s\n' "$last_login"
last -n 5 "$login_user" 2>/dev/null | awk '
  /^$/ { next }
  /^wtmp / { next }
  {
    count += 1
    printf "RECENT_LOGIN_%d=%s\n", count, $0
  }
'
`

func (s *Service) GetMetrics(ctx context.Context, userID, hostID string) (HostMetrics, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(hostID) == "" {
		return HostMetrics{}, ErrInvalidInput
	}
	client, _, err := s.OpenSSHClient(ctx, userID, hostID, TestConnectionInput{})
	if err != nil {
		return HostMetrics{}, err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return HostMetrics{}, fmt.Errorf("create host metrics session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(hostMetricsCommand)
	if err != nil {
		return HostMetrics{}, fmt.Errorf("collect host metrics: %w", err)
	}
	return parseHostMetricsCommandOutput(hostID, string(output), time.Now())
}

func parseHostMetricsCommandOutput(hostID string, output string, collectedAt time.Time) (HostMetrics, error) {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" {
		return HostMetrics{}, ErrInvalidInput
	}

	values := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}

	metrics := HostMetrics{
		HostID:      hostID,
		CollectedAt: collectedAt,
		System: HostSystemInfo{
			Hostname: values["HOSTNAME"],
			OSName:   values["OS_NAME"],
			Kernel:   values["KERNEL"],
		},
		SSH: HostSSHInfo{
			User:   values["SSH_USER"],
			Client: values["SSH_CLIENT"],
		},
		Login: HostLoginInfo{
			ActiveLoginCount: parseOptionalInt64(values["ACTIVE_LOGIN_COUNT"]),
			LastLogin:        values["LAST_LOGIN"],
			RecentLogins:     parseRecentLoginValues(values),
		},
		CPUUsagePercent:    parseOptionalFloat64(values["CPU_USAGE_PERCENT"]),
		MemoryUsagePercent: parseOptionalFloat64(values["MEMORY_USAGE_PERCENT"]),
		MemoryUsedBytes:    parseOptionalInt64(values["MEMORY_USED_BYTES"]),
		MemoryTotalBytes:   parseOptionalInt64(values["MEMORY_TOTAL_BYTES"]),
		DiskUsagePercent:   parseOptionalFloat64(values["DISK_USAGE_PERCENT"]),
		DiskUsedBytes:      parseOptionalInt64(values["DISK_USED_BYTES"]),
		DiskTotalBytes:     parseOptionalInt64(values["DISK_TOTAL_BYTES"]),
		UptimeSeconds:      parseOptionalInt64(values["UPTIME_SECONDS"]),
		GPUUsagePercent:    parseOptionalFloat64(values["GPU_USAGE_PERCENT"]),
	}
	return metrics, nil
}

func parseRecentLoginValues(values map[string]string) []string {
	records := []string{}
	for index := 1; index <= 10; index++ {
		value := strings.TrimSpace(values[fmt.Sprintf("RECENT_LOGIN_%d", index)])
		if value == "" {
			continue
		}
		records = append(records, value)
	}
	return records
}

func parseOptionalFloat64(value string) *float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func parseOptionalInt64(value string) *int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil
	}
	return &parsed
}
