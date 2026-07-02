// Package httpapi composes the platform middleware and module routes into the
// versioned /api/v1 surface. Only the foundation endpoints are wired today —
// module routes are added as each domain is migrated (Step 2+).
package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahzebs-library/tyrepulse/backend/internal/modules/assets"
	"github.com/shahzebs-library/tyrepulse/backend/internal/modules/identity"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/auth"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/database"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/httpserver"
)

// Deps are the dependencies the router needs to wire routes.
type Deps struct {
	DB              *database.DB
	Verifier        *auth.Verifier
	AllowedOrigins  []string
	RateLimitPerMin int
	IdentityHandler *identity.Handler
	AssetsHandler   *assets.Handler
}

// New builds the fully-wired HTTP handler.
func New(d Deps, mws ...func(http.Handler) http.Handler) http.Handler {
	r := chi.NewRouter()
	for _, mw := range mws {
		r.Use(mw)
	}

	// Liveness — process is up. No auth, no DB.
	r.Get("/api/v1/health", func(w http.ResponseWriter, _ *http.Request) {
		httpserver.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"}, nil)
	})

	// Readiness — dependencies (DB) are reachable.
	r.Get("/api/v1/readyz", func(w http.ResponseWriter, req *http.Request) {
		if err := d.DB.Ping(req.Context()); err != nil {
			httpserver.WriteError(w, http.StatusServiceUnavailable, httpserver.CodeUnavailable, "Database not ready.")
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"}, nil)
	})

	// Authenticated routes.
	r.Group(func(pr chi.Router) {
		pr.Use(httpserver.Authenticate(d.Verifier))
		pr.Get("/api/v1/me", d.IdentityHandler.Me)
		if d.AssetsHandler != nil {
			pr.Get("/api/v1/assets", d.AssetsHandler.List)
			pr.Get("/api/v1/assets/{id}", d.AssetsHandler.Get)
		}
	})

	return r
}
