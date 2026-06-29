// Command api is the TyrePulse HTTP API server (Phase A).
//
// It connects to the existing Supabase Postgres with server-only credentials,
// verifies Supabase-issued JWTs, and serves the versioned /api/v1 surface.
// No client ever holds the database credentials or service keys.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/shahzebs-library/tyrepulse/backend/internal/http"
	"github.com/shahzebs-library/tyrepulse/backend/internal/modules/identity"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/auth"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/config"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/database"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/httpserver"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/observability"
)

func main() {
	cfg, err := config.Load()
	logger := observability.NewLogger("info")
	if err != nil {
		logger.Error("configuration error", "error", err.Error())
		os.Exit(1)
	}
	logger = observability.NewLogger(cfg.LogLevel)

	ctx := context.Background()
	db, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err.Error())
		os.Exit(1)
	}
	defer db.Close()

	verifier := auth.NewVerifier(cfg.SupabaseJWTSec)
	identityHandler := identity.NewHandler(identity.NewRepository(db.Pool))

	handler := httpapi.New(
		httpapi.Deps{
			DB:              db,
			Verifier:        verifier,
			AllowedOrigins:  cfg.AllowedOrigins,
			RateLimitPerMin: cfg.RateLimitPerMin,
			IdentityHandler: identityHandler,
		},
		httpserver.RequestID,
		httpserver.Recover(logger),
		httpserver.AccessLog(logger),
		httpserver.CORS(cfg.AllowedOrigins),
		httpserver.RateLimit(cfg.RateLimitPerMin),
	)

	srv := httpserver.New(cfg.HTTPAddr, handler, logger, cfg.RequestTimeout)

	// Run the server until a termination signal arrives.
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start() }()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		if err != nil {
			logger.Error("server error", "error", err.Error())
			os.Exit(1)
		}
	case sig := <-stop:
		logger.Info("shutdown signal received", "signal", sig.String())
		if err := srv.Shutdown(cfg.ShutdownTimeout); err != nil {
			logger.Error("graceful shutdown failed", "error", err.Error())
			os.Exit(1)
		}
	}
}
