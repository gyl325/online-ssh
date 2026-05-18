package frontend

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestHandlerServesStaticAssets(t *testing.T) {
	handler := NewHandler(testAssets(), nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if rec.Body.String() != "console.log('online-ssh');" {
		t.Fatalf("unexpected asset body %q", rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); contentType != "text/javascript; charset=utf-8" {
		t.Fatalf("expected javascript content type, got %q", contentType)
	}
}

func TestHandlerFallsBackToIndexForSPARoutes(t *testing.T) {
	handler := NewHandler(testAssets(), nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/dashboard", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if rec.Body.String() != "<!doctype html><div id=\"root\"></div>" {
		t.Fatalf("unexpected fallback body %q", rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); contentType != "text/html; charset=utf-8" {
		t.Fatalf("expected html content type, got %q", contentType)
	}
}

func TestHandlerReturnsNotFoundForMissingStaticAssets(t *testing.T) {
	handler := NewHandler(testAssets(), nil)

	for _, target := range []string{"/assets/missing.js", "/favicon.ico"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, target, nil)
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected %s to return 404, got status %d body=%q", target, rec.Code, rec.Body.String())
		}
	}
}

func TestHandlerRejectsUnsupportedFrontendMethods(t *testing.T) {
	handler := NewHandler(testAssets(), nil)

	for _, target := range []string{"/dashboard", "/assets/app.js"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, target, nil)
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected %s to return 405, got status %d", target, rec.Code)
		}
		if allow := rec.Header().Get("Allow"); allow != "GET, HEAD" {
			t.Fatalf("expected Allow header for %s, got %q", target, allow)
		}
	}
}

func TestHandlerDoesNotFallbackForAPIRoutes(t *testing.T) {
	var delegated []string
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		delegated = append(delegated, r.URL.Path)
		w.WriteHeader(http.StatusTeapot)
	})
	handler := NewHandler(testAssets(), api)

	for _, target := range []string{"/api/missing", "/ws/terminal", "/healthz"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, target, nil)
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusTeapot {
			t.Fatalf("expected %s to delegate to API handler, got status %d", target, rec.Code)
		}
	}

	if len(delegated) != 3 {
		t.Fatalf("expected 3 delegated requests, got %d", len(delegated))
	}
}

func TestHandlerReturnsNotFoundForAPIRoutesWithoutHandler(t *testing.T) {
	handler := NewHandler(testAssets(), nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/missing", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rec.Code)
	}
}

func TestHandlerRejectsMissingIndex(t *testing.T) {
	handler := NewHandler(fstest.MapFS{
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('online-ssh');")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/dashboard", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rec.Code)
	}
}

func testAssets() fs.FS {
	return fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<!doctype html><div id=\"root\"></div>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('online-ssh');")},
	}
}
