// Package queue defines the background-job boundary. Heavy work (large report
// generation, imports, embeddings) is enqueued here and processed by the
// worker (cmd/worker). The interface lets the implementation start with Redis
// and evolve without touching producers.
package queue

import "context"

// Job is a unit of background work.
type Job struct {
	Type    string            // e.g. "report.export", "import.commit"
	Payload []byte            // JSON-encoded job arguments
	Headers map[string]string // correlation ids, scope, etc.
}

// Producer enqueues jobs.
type Producer interface {
	Enqueue(ctx context.Context, job Job) error
}

// Handler processes a single job type.
type Handler func(ctx context.Context, job Job) error

// Consumer registers handlers and runs the processing loop.
type Consumer interface {
	Register(jobType string, handler Handler)
	Run(ctx context.Context) error
}
