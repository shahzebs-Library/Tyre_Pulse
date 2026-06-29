// Package identity resolves the authenticated principal to a full profile
// (role + scope) from Postgres and serves the /api/v1/me endpoint.
//
// This is the first real boundary: the client presents a Supabase JWT, the
// API verifies it, then this module loads authoritative role/scope from the
// database — the role is never trusted from the client.
package identity

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/auth"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/httpserver"
)

// Profile is the authoritative server-side view of a user.
type Profile struct {
	ID        string   `json:"id"`
	Email     string   `json:"email,omitempty"`
	FullName  string   `json:"full_name,omitempty"`
	Username  string   `json:"username,omitempty"`
	Role      string   `json:"role"`
	Site      string   `json:"site,omitempty"`
	Country   []string `json:"country,omitempty"`
	Approved  bool     `json:"approved"`
	Locked    bool     `json:"locked"`
}

// ErrProfileNotFound indicates no profile row exists for the user id.
var ErrProfileNotFound = errors.New("profile not found")

// Repository reads profiles from Postgres.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// GetProfile loads the profile for the given user id. Only the columns the API
// needs are selected (least privilege).
func (r *Repository) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `
		SELECT id::text,
		       COALESCE(email, ''),
		       COALESCE(full_name, ''),
		       COALESCE(username, ''),
		       COALESCE(role, ''),
		       COALESCE(site, ''),
		       COALESCE(approved, false),
		       COALESCE(locked, false)
		FROM public.profiles
		WHERE id = $1`
	var p Profile
	err := r.pool.QueryRow(ctx, q, userID).Scan(
		&p.ID, &p.Email, &p.FullName, &p.Username, &p.Role, &p.Site, &p.Approved, &p.Locked,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrProfileNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// Handler serves identity endpoints.
type Handler struct {
	repo *Repository
}

// NewHandler constructs a Handler.
func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// Me returns the authenticated user's authoritative profile.
// GET /api/v1/me
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	principal := auth.PrincipalFromContext(r.Context())
	if principal == nil {
		httpserver.WriteError(w, http.StatusUnauthorized, httpserver.CodeUnauthorized, "Authentication required.")
		return
	}
	profile, err := h.repo.GetProfile(r.Context(), principal.UserID)
	if errors.Is(err, ErrProfileNotFound) {
		httpserver.WriteError(w, http.StatusNotFound, httpserver.CodeNotFound, "Profile not found.")
		return
	}
	if err != nil {
		httpserver.WriteError(w, http.StatusInternalServerError, httpserver.CodeInternal, "Could not load profile.")
		return
	}
	// Enforce account status server-side — a locked or unapproved account is
	// denied regardless of a still-valid token.
	if profile.Locked || !profile.Approved {
		httpserver.WriteError(w, http.StatusForbidden, httpserver.CodeForbidden, "Account is not active.")
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, profile, nil)
}
