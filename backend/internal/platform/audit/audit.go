// Package audit records immutable audit events for critical actions. Events
// are append-only; the API never updates or deletes them.
package audit

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Event is a single audit record.
type Event struct {
	ActorID   string         // auth user id of the actor
	Action    string         // e.g. "tyre.fitment", "accident.closure_approved"
	Entity    string         // entity type, e.g. "tyre", "accident"
	EntityID  string         // entity primary key (optional)
	RequestID string         // correlation id
	Metadata  map[string]any // structured, non-PII context
}

// Recorder persists audit events.
type Recorder struct {
	pool *pgxpool.Pool
}

// NewRecorder constructs a Recorder.
func NewRecorder(pool *pgxpool.Pool) *Recorder {
	return &Recorder{pool: pool}
}

// Record writes an audit event. It is best-effort from the caller's point of
// view: failures are returned but should never block the primary action — the
// caller decides how to handle a logging failure.
func (r *Recorder) Record(ctx context.Context, e Event) error {
	meta, err := json.Marshal(e.Metadata)
	if err != nil {
		meta = []byte(`{}`)
	}
	const q = `
		INSERT INTO public.api_audit_events
		    (actor_id, action, entity, entity_id, request_id, metadata)
		VALUES ($1, NULLIF($2,''), $3, NULLIF($4,''), NULLIF($5,''), $6)`
	_, err = r.pool.Exec(ctx, q,
		nullable(e.ActorID), e.Action, e.Entity, e.EntityID, e.RequestID, meta)
	return err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
