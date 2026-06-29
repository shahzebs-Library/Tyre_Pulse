// Package httpserver provides the HTTP response envelope, error model, and
// shared middleware used by every API route.
package httpserver

import (
	"encoding/json"
	"net/http"
)

// Envelope is the consistent JSON shape returned by every endpoint:
//
//	{ "data": <payload>, "error": <error|null>, "meta": <meta|null> }
type Envelope struct {
	Data  interface{} `json:"data,omitempty"`
	Error *APIError   `json:"error,omitempty"`
	Meta  interface{} `json:"meta,omitempty"`
}

// APIError is a structured, client-safe error. Internal detail is logged
// server-side and never leaked in the body.
type APIError struct {
	Code    string `json:"code"`    // stable machine code, e.g. "unauthorized"
	Message string `json:"message"` // human-readable, safe for the client
}

// Stable error codes shared across modules.
const (
	CodeBadRequest   = "bad_request"
	CodeUnauthorized = "unauthorized"
	CodeForbidden    = "forbidden"
	CodeNotFound     = "not_found"
	CodeConflict     = "conflict"
	CodeRateLimited  = "rate_limited"
	CodeInternal     = "internal_error"
	CodeUnavailable  = "service_unavailable"
)

// WriteJSON writes a success envelope with the given status and payload.
func WriteJSON(w http.ResponseWriter, status int, data interface{}, meta interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Envelope{Data: data, Meta: meta})
}

// WriteError writes an error envelope with the given status and structured code.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Envelope{Error: &APIError{Code: code, Message: message}})
}
