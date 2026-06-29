package httpserver

import (
	"context"
	"log/slog"
	"net/http"
	"time"
)

// Server wraps http.Server with graceful start/stop.
type Server struct {
	httpServer *http.Server
	logger     *slog.Logger
}

// New builds a Server bound to addr with the given handler and timeouts.
func New(addr string, handler http.Handler, logger *slog.Logger, reqTimeout time.Duration) *Server {
	return &Server{
		httpServer: &http.Server{
			Addr:              addr,
			Handler:           http.TimeoutHandler(handler, reqTimeout, `{"error":{"code":"service_unavailable","message":"Request timed out."}}`),
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      60 * time.Second,
			IdleTimeout:       120 * time.Second,
		},
		logger: logger,
	}
}

// Start begins serving and blocks until the server stops.
func (s *Server) Start() error {
	s.logger.Info("http server listening", "addr", s.httpServer.Addr)
	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown gracefully drains in-flight requests within the timeout.
func (s *Server) Shutdown(timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	s.logger.Info("http server shutting down")
	return s.httpServer.Shutdown(ctx)
}
