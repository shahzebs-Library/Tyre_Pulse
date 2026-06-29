package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shahzebs-library/tyrepulse/backend/internal/modules/assets"
	"github.com/shahzebs-library/tyrepulse/backend/internal/modules/identity"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/auth"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/httpserver"
)

// Health is reachable without auth or a database.
func TestHealthEndpoint(t *testing.T) {
	h := New(Deps{Verifier: auth.NewVerifier("secret")})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, want 200", rec.Code)
	}
	var env httpserver.Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	data, _ := env.Data.(map[string]any)
	if data["status"] != "ok" {
		t.Errorf("health data = %v, want status=ok", env.Data)
	}
}

// /api/v1/me rejects unauthenticated requests at the middleware.
func TestMeRequiresAuth(t *testing.T) {
	h := New(Deps{Verifier: auth.NewVerifier("secret")})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("me status = %d, want 401", rec.Code)
	}
}

// Asset endpoints sit behind the auth middleware too: no token → 401, before
// any handler/DB work. (Handler built with nil repos is never reached.)
func TestAssetsRequireAuth(t *testing.T) {
	h := New(Deps{
		Verifier:      auth.NewVerifier("secret"),
		AssetsHandler: assets.NewHandler(assets.NewRepository(nil), identity.NewRepository(nil)),
	})
	for _, path := range []string{"/api/v1/assets", "/api/v1/assets/some-id"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s status = %d, want 401", path, rec.Code)
		}
	}
}
