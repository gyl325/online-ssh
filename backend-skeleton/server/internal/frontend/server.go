package frontend

import (
	"bytes"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

type handler struct {
	assets fs.FS
	api    http.Handler
}

func NewHandler(assets fs.FS, api http.Handler) http.Handler {
	return handler{
		assets: assets,
		api:    api,
	}
}

func (h handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isAPIRoute(r.URL.Path) {
		if h.api != nil {
			h.api.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if h.assets == nil || hasPathTraversal(r.URL.Path) {
		http.NotFound(w, r)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name != "" && name != "." {
		if data, err := fs.ReadFile(h.assets, name); err == nil {
			http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
			return
		}
	}
	if isStaticAssetPath(name) {
		http.NotFound(w, r)
		return
	}

	data, err := fs.ReadFile(h.assets, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(data))
}

func isAPIRoute(requestPath string) bool {
	return requestPath == "/healthz" ||
		requestPath == "/api" ||
		strings.HasPrefix(requestPath, "/api/") ||
		requestPath == "/ws" ||
		strings.HasPrefix(requestPath, "/ws/")
}

func hasPathTraversal(requestPath string) bool {
	for _, segment := range strings.Split(requestPath, "/") {
		if segment == ".." {
			return true
		}
	}
	return false
}

func isStaticAssetPath(name string) bool {
	return strings.HasPrefix(name, "assets/") || path.Ext(name) != ""
}
