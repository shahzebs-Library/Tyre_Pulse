// Package database owns the Postgres connection pool. In Phase A this connects
// to the existing Supabase Postgres using a server-only DATABASE_URL; clients
// never hold these credentials.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps a pgx pool with lifecycle helpers.
type DB struct {
	Pool *pgxpool.Pool
}

// Connect opens and verifies a pooled connection to Postgres.
func Connect(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &DB{Pool: pool}, nil
}

// Ping verifies the database is reachable (used by readiness checks).
func (d *DB) Ping(ctx context.Context) error {
	if d == nil || d.Pool == nil {
		return fmt.Errorf("database not initialised")
	}
	return d.Pool.Ping(ctx)
}

// Close releases all pooled connections.
func (d *DB) Close() {
	if d != nil && d.Pool != nil {
		d.Pool.Close()
	}
}
