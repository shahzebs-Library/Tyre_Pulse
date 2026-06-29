package httpserver

import (
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/auth"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/observability"
)

// RequestID assigns/propagates an X-Request-Id and stores it on the context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-Id", id)
		ctx := observability.WithRequestID(r.Context(), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Recover converts panics into a clean 500 without leaking internals.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					observability.LoggerWithRequest(r.Context(), logger).
						Error("panic recovered", "panic", rec, "path", r.URL.Path)
					WriteError(w, http.StatusInternalServerError, CodeInternal, "Something went wrong.")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// AccessLog emits a structured line per request with status and latency.
func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r)
			observability.LoggerWithRequest(r.Context(), logger).Info("request",
				"method", r.Method, "path", r.URL.Path,
				"status", sw.status, "duration_ms", time.Since(start).Milliseconds())
		})
	}
}

// CORS applies a strict origin allow-list.
func CORS(allowed []string) func(http.Handler) http.Handler {
	allowSet := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		allowSet[o] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if _, ok := allowSet[origin]; ok {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-Id")
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Authenticate verifies the bearer token and stores the principal on the
// context. Requests without a valid token are rejected with 401.
func Authenticate(verifier *auth.Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := bearerToken(r)
			principal, err := verifier.Verify(raw)
			if err != nil {
				WriteError(w, http.StatusUnauthorized, CodeUnauthorized, "Authentication required.")
				return
			}
			ctx := auth.WithPrincipal(r.Context(), principal)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// RateLimit applies a simple fixed-window per-client-IP limit. It is a
// first-line guard; production deployments should also enforce limits at the
// edge/reverse proxy and via Redis for multi-instance accuracy.
func RateLimit(perMinute int) func(http.Handler) http.Handler {
	type bucket struct {
		count       int
		windowStart time.Time
	}
	var (
		mu      sync.Mutex
		clients = make(map[string]*bucket)
	)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if perMinute <= 0 {
				next.ServeHTTP(w, r)
				return
			}
			ip := clientIP(r)
			now := time.Now()
			mu.Lock()
			b, ok := clients[ip]
			if !ok || now.Sub(b.windowStart) > time.Minute {
				b = &bucket{count: 0, windowStart: now}
				clients[ip] = b
			}
			b.count++
			over := b.count > perMinute
			mu.Unlock()
			if over {
				WriteError(w, http.StatusTooManyRequests, CodeRateLimited, "Too many requests. Please slow down.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i >= 0 {
		return host[:i]
	}
	return host
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
