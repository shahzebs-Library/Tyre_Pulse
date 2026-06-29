// Command worker processes background jobs (report generation, imports,
// embeddings) off the request path. It is a skeleton in Step 1: it boots,
// validates config, and waits for a termination signal. Real handlers are
// registered as the relevant modules are migrated (Step 3+).
package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/config"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/observability"
)

func main() {
	logger := observability.NewLogger("info")
	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration error", "error", err.Error())
		os.Exit(1)
	}
	logger = observability.NewLogger(cfg.LogLevel)
	logger.Info("worker started (no job handlers registered yet)")

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	sig := <-stop
	logger.Info("worker shutting down", "signal", sig.String())
}
