package httpserver

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

// Pagination defaults and bounds.
const (
	DefaultPageLimit = 50
	MaxPageLimit     = 200
)

// Cursor is an opaque keyset position. We page by (created_at, id) descending,
// which is stable under inserts — unlike offset paging.
type Cursor struct {
	CreatedAt time.Time `json:"c"`
	ID        string    `json:"i"`
}

// Encode serializes a cursor to an opaque base64 token.
func (c Cursor) Encode() string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeCursor parses an opaque token. Returns (nil, nil) for an empty token
// (first page) and an error for a malformed one.
func DecodeCursor(token string) (*Cursor, error) {
	if token == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, err
	}
	var c Cursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// ParseLimit reads ?limit, clamping to [1, MaxPageLimit] with a sane default.
func ParseLimit(r *http.Request) int {
	v := r.URL.Query().Get("limit")
	if v == "" {
		return DefaultPageLimit
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return DefaultPageLimit
	}
	if n > MaxPageLimit {
		return MaxPageLimit
	}
	return n
}

// Page is the standard list payload returned in the envelope's `data`.
type Page struct {
	Items      interface{} `json:"items"`
	NextCursor string      `json:"next_cursor,omitempty"`
}
