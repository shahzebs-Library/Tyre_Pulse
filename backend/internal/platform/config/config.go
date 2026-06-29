// Package config loads and validates runtime configuration from the environment.
// All secrets and connection details are server-side only — never compiled into
// the web or mobile clients.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the fully-resolved application configuration.
type Config struct {
	Env             string        // "development" | "staging" | "production"
	HTTPAddr        string        // listen address, e.g. ":8080"
	DatabaseURL     string        // server-only Postgres DSN (Supabase Postgres in Phase A)
	SupabaseJWTSec  string        // HS256 secret used to verify Supabase-issued JWTs
	AllowedOrigins  []string      // CORS allow-list
	RequestTimeout  time.Duration // per-request timeout
	ShutdownTimeout time.Duration // graceful shutdown budget
	RateLimitPerMin int           // per-IP request budget per minute
	LogLevel        string        // "debug" | "info" | "warn" | "error"
}

// Load reads configuration from the environment, applies safe defaults, and
// validates required values. It returns an error listing every problem so the
// operator can fix them in one pass rather than one at a time.
func Load() (*Config, error) {
	cfg := &Config{
		Env:             getEnv("APP_ENV", "development"),
		HTTPAddr:        getEnv("HTTP_ADDR", ":8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		SupabaseJWTSec:  os.Getenv("SUPABASE_JWT_SECRET"),
		AllowedOrigins:  splitAndTrim(getEnv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174")),
		RequestTimeout:  getDuration("REQUEST_TIMEOUT", 30*time.Second),
		ShutdownTimeout: getDuration("SHUTDOWN_TIMEOUT", 15*time.Second),
		RateLimitPerMin: getInt("RATE_LIMIT_PER_MIN", 120),
		LogLevel:        getEnv("LOG_LEVEL", "info"),
	}

	var problems []string
	if cfg.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required (server-only Postgres DSN)")
	}
	if cfg.SupabaseJWTSec == "" {
		problems = append(problems, "SUPABASE_JWT_SECRET is required (HS256 secret to verify Supabase JWTs)")
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("invalid configuration:\n  - %s", strings.Join(problems, "\n  - "))
	}
	return cfg, nil
}

// IsProduction reports whether the app is running in production mode.
func (c *Config) IsProduction() bool { return c.Env == "production" }

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
