package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

const (
	defaultBaseURL     = "http://127.0.0.1:8080"
	defaultSmokeEmail  = "online-ssh-smoke@example.local"
	defaultSmokeSecret = "OnlineSshSmoke123!"
)

type smokeConfig struct {
	baseURL         string
	email           string
	password        string
	serverHost      string
	serverPort      int
	serverUser      string
	serverPass      string
	remoteDir       string
	runWriteFlow    bool
	terminalCommand string
	terminalExpect  string
	terminalTimeout time.Duration
}

type smokeClient struct {
	baseURL string
	http    *http.Client
}

type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type smokeFileEntry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	EntryType string `json:"entry_type"`
}

func main() {
	if err := loadDotEnv(".env.local"); err != nil {
		fail("load .env.local: %v", err)
	}

	cfg, err := loadConfig()
	if err != nil {
		fail("%v", err)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		fail("create cookie jar: %v", err)
	}
	client := &smokeClient{
		baseURL: strings.TrimRight(cfg.baseURL, "/"),
		http: &http.Client{
			Jar:     jar,
			Timeout: 30 * time.Second,
		},
	}

	fmt.Printf("Online SSH smoke test target: %s\n", client.baseURL)

	if err := client.checkHealth(); err != nil {
		fail("health check failed: %v", err)
	}
	if err := client.ensureLogin(cfg.email, cfg.password); err != nil {
		fail("authentication failed: %v", err)
	}

	credentialID, err := client.createCredential(cfg)
	if err != nil {
		fail("create credential failed: %v", err)
	}
	defer client.cleanupCredential(credentialID)

	hostID, err := client.createHost(cfg, credentialID)
	if err != nil {
		fail("create host failed: %v", err)
	}
	defer client.cleanupHost(hostID)

	if err := client.testHostWithFingerprintConfirm(hostID); err != nil {
		fail("host SSH test failed: %v", err)
	}
	if err := client.listRemoteDirectory(hostID, cfg.remoteDir); err != nil {
		fail("SFTP directory list failed: %v", err)
	}
	if err := client.bootstrapAttachAndCloseTerminal(hostID, cfg); err != nil {
		fail("terminal websocket smoke failed: %v", err)
	}
	if cfg.runWriteFlow {
		if err := client.runWriteFileFlow(hostID, cfg.remoteDir); err != nil {
			fail("SFTP write file flow failed: %v", err)
		}
	} else {
		fmt.Println("skip write flow: set ONLINE_SSH_SMOKE_RUN_WRITE=1 to create, edit, transfer, and delete remote test files")
	}

	fmt.Println("smoke test passed")
}

func loadConfig() (smokeConfig, error) {
	serverHost := env("SERVER_HOST", "")
	serverUser := env("SERVER_USERNAME", "")
	serverPass := env("SERVER_PASSWORD", "")
	if serverHost == "" || serverUser == "" || serverPass == "" {
		return smokeConfig{}, errors.New("SERVER_HOST, SERVER_USERNAME and SERVER_PASSWORD are required")
	}

	serverPort, err := strconv.Atoi(env("SERVER_PORT", "22"))
	if err != nil || serverPort <= 0 {
		return smokeConfig{}, errors.New("SERVER_PORT must be a positive integer")
	}

	terminalExpect := env("ONLINE_SSH_SMOKE_TERMINAL_EXPECT", "")
	terminalCommand := env("ONLINE_SSH_SMOKE_TERMINAL_COMMAND", "")
	if terminalExpect == "" {
		terminalExpect = "online-ssh-smoke-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	if terminalCommand == "" {
		terminalCommand = "printf '" + terminalExpect + "\\n'"
	}

	return smokeConfig{
		baseURL:         env("ONLINE_SSH_SMOKE_BASE_URL", defaultBaseURL),
		email:           env("ONLINE_SSH_SMOKE_EMAIL", defaultSmokeEmail),
		password:        env("ONLINE_SSH_SMOKE_PASSWORD", defaultSmokeSecret),
		serverHost:      serverHost,
		serverPort:      serverPort,
		serverUser:      serverUser,
		serverPass:      serverPass,
		remoteDir:       env("ONLINE_SSH_SMOKE_REMOTE_DIR", "/tmp"),
		runWriteFlow:    envBool("ONLINE_SSH_SMOKE_RUN_WRITE", false),
		terminalCommand: terminalCommand,
		terminalExpect:  terminalExpect,
		terminalTimeout: time.Duration(envInt("ONLINE_SSH_SMOKE_TERMINAL_TIMEOUT_SECONDS", 20)) * time.Second,
	}, nil
}

func (c *smokeClient) checkHealth() error {
	var payload map[string]any
	if _, err := c.do("GET", "/healthz", nil, &payload, http.StatusOK); err != nil {
		return err
	}
	if payload["status"] != "ok" {
		return fmt.Errorf("unexpected health payload: %#v", payload)
	}
	fmt.Println("ok: healthz")
	return nil
}

func (c *smokeClient) ensureLogin(email, password string) error {
	var config struct {
		AllowRegistration bool `json:"allow_registration"`
	}
	if _, err := c.do("GET", "/api/auth/config", nil, &config, http.StatusOK); err != nil {
		return err
	}

	if config.AllowRegistration {
		status, err := c.do("POST", "/api/auth/register", map[string]any{
			"email":        email,
			"password":     password,
			"display_name": "Online SSH Smoke",
		}, nil, http.StatusCreated, http.StatusConflict)
		if err != nil {
			return err
		}
		if status == http.StatusCreated {
			fmt.Println("ok: registered smoke user")
		} else {
			fmt.Println("ok: smoke user already exists")
		}
	} else {
		fmt.Println("registration disabled: using existing smoke user credentials")
	}

	if _, err := c.do("POST", "/api/auth/login", map[string]any{
		"email":    email,
		"password": password,
	}, nil, http.StatusOK); err != nil {
		return err
	}
	if _, err := c.do("GET", "/api/auth/me", nil, nil, http.StatusOK); err != nil {
		return err
	}
	fmt.Println("ok: login and auth/me")
	return nil
}

func (c *smokeClient) createCredential(cfg smokeConfig) (string, error) {
	var payload struct {
		Credential struct {
			ID string `json:"id"`
		} `json:"credential"`
	}
	_, err := c.do("POST", "/api/credentials", map[string]any{
		"name":      "smoke-password-" + strconv.FormatInt(time.Now().Unix(), 10),
		"auth_type": "password",
		"password":  cfg.serverPass,
	}, &payload, http.StatusCreated)
	if err != nil {
		return "", err
	}
	if payload.Credential.ID == "" {
		return "", errors.New("credential id missing from response")
	}
	fmt.Println("ok: credential created")
	return payload.Credential.ID, nil
}

func (c *smokeClient) createHost(cfg smokeConfig, credentialID string) (string, error) {
	var payload struct {
		Host struct {
			ID string `json:"id"`
		} `json:"host"`
	}
	_, err := c.do("POST", "/api/hosts", map[string]any{
		"name":          "smoke-host-" + strconv.FormatInt(time.Now().Unix(), 10),
		"host":          cfg.serverHost,
		"port":          cfg.serverPort,
		"username":      cfg.serverUser,
		"auth_type":     "password",
		"credential_id": credentialID,
	}, &payload, http.StatusCreated)
	if err != nil {
		return "", err
	}
	if payload.Host.ID == "" {
		return "", errors.New("host id missing from response")
	}
	fmt.Println("ok: host created")
	return payload.Host.ID, nil
}

func (c *smokeClient) testHostWithFingerprintConfirm(hostID string) error {
	status, body, err := c.doRaw("POST", "/api/hosts/"+url.PathEscape(hostID)+"/test", map[string]any{})
	if err != nil {
		return err
	}
	if status == http.StatusConflict {
		var conflict struct {
			Code               string `json:"code"`
			CurrentFingerprint struct {
				Algorithm   string `json:"algorithm"`
				Fingerprint string `json:"fingerprint"`
			} `json:"current_fingerprint"`
		}
		if err := json.Unmarshal(body, &conflict); err != nil {
			return fmt.Errorf("decode fingerprint conflict: %w", err)
		}
		if conflict.CurrentFingerprint.Algorithm == "" || conflict.CurrentFingerprint.Fingerprint == "" {
			return fmt.Errorf("fingerprint conflict missing current fingerprint: %s", string(body))
		}
		_, err := c.do("POST", "/api/hosts/"+url.PathEscape(hostID)+"/fingerprint/confirm", map[string]any{
			"algorithm":   conflict.CurrentFingerprint.Algorithm,
			"fingerprint": conflict.CurrentFingerprint.Fingerprint,
		}, nil, http.StatusOK)
		if err != nil {
			return err
		}
		fmt.Printf("ok: fingerprint confirmed (%s)\n", conflict.Code)
		status, body, err = c.doRaw("POST", "/api/hosts/"+url.PathEscape(hostID)+"/test", map[string]any{})
		if err != nil {
			return err
		}
	}
	if status != http.StatusOK {
		return decodeHTTPError(status, body)
	}

	var payload struct {
		OK      bool   `json:"ok"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("decode host test response: %w", err)
	}
	if !payload.OK {
		return fmt.Errorf("host test returned not ok: %s", payload.Message)
	}
	fmt.Println("ok: SSH host test")
	return nil
}

func (c *smokeClient) listRemoteDirectory(hostID, remoteDir string) error {
	query := url.Values{}
	query.Set("host_id", hostID)
	query.Set("path", remoteDir)
	query.Set("limit", "20")

	var payload struct {
		Items []smokeFileEntry `json:"items"`
	}
	if _, err := c.do("GET", "/api/files/list?"+query.Encode(), nil, &payload, http.StatusOK); err != nil {
		return err
	}
	fmt.Printf("ok: SFTP list %s (%d entries)\n", remoteDir, len(payload.Items))
	return nil
}

func (c *smokeClient) bootstrapAttachAndCloseTerminal(hostID string, cfg smokeConfig) error {
	var payload struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
		WebSocket struct {
			URL      string `json:"url"`
			Protocol string `json:"protocol"`
		} `json:"websocket"`
	}
	if _, err := c.do("POST", "/api/terminal/sessions", map[string]any{
		"host_id": hostID,
		"rows":    24,
		"cols":    80,
	}, &payload, http.StatusCreated); err != nil {
		return err
	}
	if payload.Session.ID == "" {
		return errors.New("terminal session id missing from response")
	}
	defer func() {
		if _, err := c.do("POST", "/api/terminal/sessions/"+url.PathEscape(payload.Session.ID)+"/close", nil, nil, http.StatusOK, http.StatusNotFound, http.StatusConflict); err != nil {
			fmt.Printf("warn: terminal cleanup failed: %v\n", err)
		}
	}()

	wsURL, err := c.resolveWebSocketURL(payload.WebSocket.URL, payload.Session.ID)
	if err != nil {
		return err
	}
	conn, err := c.dialTerminalWebSocket(wsURL, payload.WebSocket.Protocol)
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := c.verifyTerminalIO(conn, cfg.terminalCommand, cfg.terminalExpect, cfg.terminalTimeout); err != nil {
		return err
	}
	fmt.Printf("ok: terminal websocket IO (%s)\n", cfg.terminalExpect)
	return nil
}

func (c *smokeClient) resolveWebSocketURL(rawURL, sessionID string) (string, error) {
	if strings.TrimSpace(rawURL) != "" {
		parsed, err := url.Parse(rawURL)
		if err != nil {
			return "", fmt.Errorf("parse terminal websocket url: %w", err)
		}
		if parsed.IsAbs() {
			return parsed.String(), nil
		}
	}

	base, err := url.Parse(c.baseURL)
	if err != nil {
		return "", fmt.Errorf("parse smoke base url: %w", err)
	}
	switch base.Scheme {
	case "https":
		base.Scheme = "wss"
	default:
		base.Scheme = "ws"
	}
	base.Path = "/ws/terminal"
	base.RawQuery = url.Values{
		"session_id": []string{sessionID},
		"rows":       []string{"24"},
		"cols":       []string{"80"},
	}.Encode()
	return base.String(), nil
}

func (c *smokeClient) dialTerminalWebSocket(wsURL, protocol string) (*websocket.Conn, error) {
	parsed, err := url.Parse(wsURL)
	if err != nil {
		return nil, fmt.Errorf("parse websocket url: %w", err)
	}
	httpURL := *parsed
	switch parsed.Scheme {
	case "wss":
		httpURL.Scheme = "https"
	default:
		httpURL.Scheme = "http"
	}

	header := http.Header{}
	header.Set("User-Agent", "online-ssh-smoke/1.0")
	if c.http.Jar != nil {
		cookies := c.http.Jar.Cookies(&httpURL)
		values := make([]string, 0, len(cookies))
		for _, cookie := range cookies {
			values = append(values, cookie.Name+"="+cookie.Value)
		}
		if len(values) > 0 {
			header.Set("Cookie", strings.Join(values, "; "))
		}
	}

	subprotocols := []string(nil)
	if protocol != "" {
		subprotocols = []string{protocol}
	}
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		Subprotocols:     subprotocols,
	}
	conn, resp, err := dialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			raw, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			return nil, fmt.Errorf("dial terminal websocket: HTTP %d: %s: %w", resp.StatusCode, strings.TrimSpace(string(raw)), err)
		}
		return nil, fmt.Errorf("dial terminal websocket: %w", err)
	}
	return conn, nil
}

func (c *smokeClient) verifyTerminalIO(conn *websocket.Conn, command, expected string, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	deadline := time.Now().Add(timeout)
	buffer := strings.Builder{}
	ready := false
	sent := false

	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			if netErr, ok := err.(interface{ Timeout() bool }); ok && netErr.Timeout() {
				continue
			}
			return fmt.Errorf("read terminal websocket: %w", err)
		}

		switch messageType {
		case websocket.TextMessage:
			var event struct {
				Type    string `json:"type"`
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(payload, &event); err != nil {
				continue
			}
			switch event.Type {
			case "ready":
				ready = true
				if !sent {
					if err := conn.WriteJSON(map[string]any{
						"type": "input",
						"data": command + "\n",
					}); err != nil {
						return fmt.Errorf("send terminal command: %w", err)
					}
					sent = true
				}
			case "error":
				return fmt.Errorf("terminal websocket error %s: %s", event.Code, event.Message)
			case "exit":
				if strings.Contains(buffer.String(), expected) {
					return nil
				}
				return fmt.Errorf("terminal exited before expected output %q; output=%q", expected, buffer.String())
			}
		case websocket.BinaryMessage:
			buffer.Write(payload)
			if strings.Contains(buffer.String(), expected) {
				return nil
			}
		}
	}
	return fmt.Errorf("terminal output %q not observed before timeout; ready=%t sent=%t output=%q", expected, ready, sent, buffer.String())
}

func (c *smokeClient) runWriteFileFlow(hostID, remoteDir string) error {
	token := "online-ssh-smoke-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	workDir := path.Join(remoteDir, token)
	sourcePath := path.Join(workDir, "source.txt")
	renamedPath := path.Join(workDir, "renamed.txt")
	uploadFileName := "uploaded.txt"
	uploadPath := path.Join(workDir, uploadFileName)
	sourceContent := "online ssh smoke write " + token + "\n"
	uploadContent := []byte("online ssh smoke upload " + token + "\n")

	if _, err := c.do("POST", "/api/files/mkdir", map[string]any{
		"host_id": hostID,
		"path":    workDir,
	}, nil, http.StatusCreated); err != nil {
		return err
	}
	cleanupWorkDir := true
	defer func() {
		if cleanupWorkDir {
			if _, err := c.do("POST", "/api/files/delete", map[string]any{
				"host_id":   hostID,
				"path":      workDir,
				"recursive": true,
			}, nil, http.StatusOK, http.StatusNotFound); err != nil {
				fmt.Printf("warn: write flow cleanup failed for %s: %v\n", workDir, err)
			}
		}
	}()

	if err := c.assertListed(hostID, remoteDir, path.Base(workDir), "directory"); err != nil {
		return err
	}
	fmt.Printf("ok: mkdir %s\n", workDir)

	if _, err := c.do("POST", "/api/files/touch", map[string]any{
		"host_id": hostID,
		"path":    sourcePath,
	}, nil, http.StatusCreated); err != nil {
		return err
	}
	if _, err := c.do("PUT", "/api/files/content", map[string]any{
		"host_id": hostID,
		"path":    sourcePath,
		"content": sourceContent,
	}, nil, http.StatusOK); err != nil {
		return err
	}
	if err := c.assertFileContent(hostID, sourcePath, sourceContent); err != nil {
		return err
	}
	if _, err := c.do("POST", "/api/files/chmod", map[string]any{
		"host_id": hostID,
		"path":    sourcePath,
		"mode":    "0644",
	}, nil, http.StatusOK); err != nil {
		return err
	}
	fmt.Printf("ok: touch/write/read/chmod %s\n", sourcePath)

	if _, err := c.do("POST", "/api/files/rename", map[string]any{
		"host_id":  hostID,
		"old_path": sourcePath,
		"new_path": renamedPath,
	}, nil, http.StatusOK); err != nil {
		return err
	}
	if err := c.assertFileContent(hostID, renamedPath, sourceContent); err != nil {
		return err
	}
	if err := c.assertSearchResult(hostID, workDir, "renamed", renamedPath); err != nil {
		return err
	}
	fmt.Printf("ok: rename/search %s\n", renamedPath)

	if err := c.downloadAndVerifyFile(hostID, renamedPath, sourceContent); err != nil {
		return err
	}
	if err := c.uploadAndVerifyFile(hostID, workDir, uploadFileName, uploadPath, uploadContent); err != nil {
		return err
	}

	for _, remotePath := range []string{renamedPath, uploadPath} {
		if _, err := c.do("POST", "/api/files/delete", map[string]any{
			"host_id":   hostID,
			"path":      remotePath,
			"recursive": false,
		}, nil, http.StatusOK); err != nil {
			return err
		}
	}
	if _, err := c.do("POST", "/api/files/delete", map[string]any{
		"host_id":   hostID,
		"path":      workDir,
		"recursive": false,
	}, nil, http.StatusOK); err != nil {
		return err
	}
	cleanupWorkDir = false
	fmt.Printf("ok: delete write flow paths under %s\n", workDir)
	return nil
}

func (c *smokeClient) assertListed(hostID, remoteDir, name, entryType string) error {
	query := url.Values{}
	query.Set("host_id", hostID)
	query.Set("path", remoteDir)
	query.Set("limit", "5000")

	var payload struct {
		Items []smokeFileEntry `json:"items"`
	}
	if _, err := c.do("GET", "/api/files/list?"+query.Encode(), nil, &payload, http.StatusOK); err != nil {
		return err
	}
	for _, item := range payload.Items {
		if item.Name == name && (entryType == "" || item.EntryType == entryType) {
			return nil
		}
	}
	return fmt.Errorf("expected %s %q in directory listing for %s", entryType, name, remoteDir)
}

func (c *smokeClient) assertSearchResult(hostID, basePath, keyword, expectedPath string) error {
	query := url.Values{}
	query.Set("host_id", hostID)
	query.Set("base_path", basePath)
	query.Set("keyword", keyword)
	query.Set("recursive", "false")

	var payload struct {
		Items []smokeFileEntry `json:"items"`
	}
	if _, err := c.do("GET", "/api/files/search?"+query.Encode(), nil, &payload, http.StatusOK); err != nil {
		return err
	}
	for _, item := range payload.Items {
		if item.Path == expectedPath {
			return nil
		}
	}
	return fmt.Errorf("expected search result %s under %s for keyword %q", expectedPath, basePath, keyword)
}

func (c *smokeClient) assertFileContent(hostID, remotePath, expected string) error {
	query := url.Values{}
	query.Set("host_id", hostID)
	query.Set("path", remotePath)

	var payload struct {
		Content string `json:"content"`
	}
	if _, err := c.do("GET", "/api/files/content?"+query.Encode(), nil, &payload, http.StatusOK); err != nil {
		return err
	}
	if payload.Content != expected {
		return fmt.Errorf("unexpected content for %s: got %q want %q", remotePath, payload.Content, expected)
	}
	return nil
}

func (c *smokeClient) downloadAndVerifyFile(hostID, remotePath, expected string) error {
	var createResp struct {
		Task struct {
			ID string `json:"id"`
		} `json:"task"`
	}
	if _, err := c.do("POST", "/api/files/download", map[string]any{
		"host_id":     hostID,
		"source_path": remotePath,
	}, &createResp, http.StatusAccepted); err != nil {
		return err
	}
	if createResp.Task.ID == "" {
		return errors.New("download task id missing from response")
	}
	if err := c.waitTransferCompleted(createResp.Task.ID); err != nil {
		return err
	}
	status, body, err := c.doRaw("GET", "/api/transfers/"+url.PathEscape(createResp.Task.ID)+"/content", nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return decodeHTTPError(status, body)
	}
	if string(body) != expected {
		return fmt.Errorf("unexpected downloaded content for %s: got %q want %q", remotePath, string(body), expected)
	}
	fmt.Printf("ok: download verified %s\n", remotePath)
	return nil
}

func (c *smokeClient) uploadAndVerifyFile(hostID, remoteDir, fileName, remotePath string, content []byte) error {
	var initResp struct {
		TaskID    string `json:"task_id"`
		ChunkSize int64  `json:"chunk_size"`
		Status    string `json:"status"`
	}
	if _, err := c.do("POST", "/api/transfers/upload/init", map[string]any{
		"target_host_id": hostID,
		"target_path":    remoteDir,
		"file_name":      fileName,
		"file_size":      len(content),
	}, &initResp, http.StatusOK); err != nil {
		return err
	}
	if initResp.TaskID == "" {
		return errors.New("upload task id missing from response")
	}

	if _, err := c.doBytes("PATCH", "/api/transfers/upload/"+url.PathEscape(initResp.TaskID)+"/chunk?offset=0", content, nil, http.StatusOK); err != nil {
		return err
	}
	if err := c.waitTransferCompleted(initResp.TaskID); err != nil {
		return err
	}
	if err := c.assertFileContent(hostID, remotePath, string(content)); err != nil {
		return err
	}
	fmt.Printf("ok: upload verified %s\n", remotePath)
	return nil
}

func (c *smokeClient) waitTransferCompleted(taskID string) error {
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		var payload struct {
			Task struct {
				Status       string  `json:"status"`
				ErrorCode    *string `json:"error_code"`
				ErrorMessage *string `json:"error_message"`
			} `json:"task"`
		}
		if _, err := c.do("GET", "/api/transfers/"+url.PathEscape(taskID), nil, &payload, http.StatusOK); err != nil {
			return err
		}
		switch payload.Task.Status {
		case "completed":
			return nil
		case "failed", "canceled":
			return fmt.Errorf("transfer ended with status=%s code=%s message=%s", payload.Task.Status, deref(payload.Task.ErrorCode), deref(payload.Task.ErrorMessage))
		}
		time.Sleep(time.Second)
	}
	return errors.New("transfer did not complete before timeout")
}

func (c *smokeClient) cleanupCredential(credentialID string) {
	if credentialID == "" {
		return
	}
	if _, err := c.do("DELETE", "/api/credentials/"+url.PathEscape(credentialID), nil, nil, http.StatusNoContent, http.StatusNotFound); err != nil {
		fmt.Printf("warn: cleanup credential failed: %v\n", err)
		return
	}
	fmt.Println("ok: credential cleanup")
}

func (c *smokeClient) cleanupHost(hostID string) {
	if hostID == "" {
		return
	}
	if _, err := c.do("DELETE", "/api/hosts/"+url.PathEscape(hostID), nil, nil, http.StatusNoContent, http.StatusNotFound); err != nil {
		fmt.Printf("warn: cleanup host failed: %v\n", err)
		return
	}
	fmt.Println("ok: host cleanup")
}

func (c *smokeClient) do(method, target string, payload any, out any, allowed ...int) (int, error) {
	status, body, err := c.doRaw(method, target, payload)
	if err != nil {
		return 0, err
	}
	if !statusAllowed(status, allowed) {
		return status, decodeHTTPError(status, body)
	}
	if out != nil && len(body) > 0 {
		if err := json.Unmarshal(body, out); err != nil {
			return status, fmt.Errorf("decode response: %w; body=%s", err, string(body))
		}
	}
	return status, nil
}

func (c *smokeClient) doBytes(method, target string, payload []byte, out any, allowed ...int) (int, error) {
	status, body, err := c.doRawWithBody(method, target, bytes.NewReader(payload), "application/octet-stream")
	if err != nil {
		return 0, err
	}
	if !statusAllowed(status, allowed) {
		return status, decodeHTTPError(status, body)
	}
	if out != nil && len(body) > 0 {
		if err := json.Unmarshal(body, out); err != nil {
			return status, fmt.Errorf("decode response: %w; body=%s", err, string(body))
		}
	}
	return status, nil
}

func (c *smokeClient) doRaw(method, target string, payload any) (int, []byte, error) {
	var body io.Reader
	contentType := ""
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(raw)
		contentType = "application/json"
	}
	return c.doRawWithBody(method, target, body, contentType)
}

func (c *smokeClient) doRawWithBody(method, target string, body io.Reader, contentType string) (int, []byte, error) {
	req, err := http.NewRequest(method, c.baseURL+target, body)
	if err != nil {
		return 0, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "online-ssh-smoke/1.0")

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, raw, nil
}

func decodeHTTPError(status int, body []byte) error {
	var payload errorResponse
	if err := json.Unmarshal(body, &payload); err == nil && payload.Code != "" {
		return fmt.Errorf("HTTP %d %s: %s", status, payload.Code, payload.Message)
	}
	return fmt.Errorf("HTTP %d: %s", status, strings.TrimSpace(string(body)))
}

func statusAllowed(status int, allowed []int) bool {
	for _, item := range allowed {
		if status == item {
			return true
		}
	}
	return false
}

func loadDotEnv(filename string) error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}

	for dir := wd; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, filename)
		if _, err := os.Stat(candidate); err == nil {
			content, err := os.ReadFile(candidate)
			if err != nil {
				return err
			}
			envMap, err := godotenv.Unmarshal(normalizeDotEnvContent(string(content)))
			if err != nil {
				return err
			}
			for key, value := range envMap {
				if _, exists := os.LookupEnv(key); !exists {
					if err := os.Setenv(key, value); err != nil {
						return err
					}
				}
			}
			return nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return nil
		}
	}
}

func normalizeDotEnvContent(content string) string {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "```") {
		return content
	}

	lines := strings.Split(trimmed, "\n")
	if len(lines) > 0 && strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
		lines = lines[1:]
	}
	if len(lines) > 0 && strings.HasPrefix(strings.TrimSpace(lines[len(lines)-1]), "```") {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n")
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "smoke test failed: "+format+"\n", args...)
	os.Exit(1)
}
