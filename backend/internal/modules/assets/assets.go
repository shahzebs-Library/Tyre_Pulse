// Package assets serves read access to fleet assets (Phase A: backed by the
// existing vehicle_fleet table). It demonstrates the canonical read pattern:
// JWT-authenticated, server-side scope enforcement (country), keyset
// pagination, and the standard response envelope. Writes and the canonical
// `assets` schema (ADR 0002) land in the assets cutover.
package assets

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahzebs-library/tyrepulse/backend/internal/modules/identity"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/auth"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/authorization"
	"github.com/shahzebs-library/tyrepulse/backend/internal/platform/httpserver"
)

// Asset is the API view of a fleet asset.
type Asset struct {
	ID            string    `json:"id"`
	AssetNo       string    `json:"asset_no"`
	FleetNumber   string    `json:"fleet_number,omitempty"`
	Make          string    `json:"make,omitempty"`
	Model         string    `json:"model,omitempty"`
	VehicleType   string    `json:"vehicle_type,omitempty"`
	Site          string    `json:"site,omitempty"`
	Country       string    `json:"country,omitempty"`
	Status        string    `json:"status,omitempty"`
	IsActive      bool      `json:"is_active"`
	CurrentKm     float64   `json:"current_km,omitempty"`
	TyreSize      string    `json:"tyre_size,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// ListFilter scopes and filters a listing. Countries nil means unrestricted
// (elevated roles); otherwise the result is limited to those countries (or rows
// with a null country, which are legitimately uncategorised).
type ListFilter struct {
	Countries []string
	Site      string
	Status    string
	Query     string
}

// Repository reads assets from Postgres (vehicle_fleet in Phase A).
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const selectCols = `
	id::text, COALESCE(asset_no,''), COALESCE(fleet_number,''), COALESCE(make,''),
	COALESCE(model,''), COALESCE(vehicle_type,''), COALESCE(site,''), COALESCE(country,''),
	COALESCE(status,''), COALESCE(is_active,true), COALESCE(current_km,0),
	COALESCE(tyre_size,''), created_at`

func scanAsset(rows pgx.Rows) (Asset, error) {
	var a Asset
	err := rows.Scan(&a.ID, &a.AssetNo, &a.FleetNumber, &a.Make, &a.Model,
		&a.VehicleType, &a.Site, &a.Country, &a.Status, &a.IsActive,
		&a.CurrentKm, &a.TyreSize, &a.CreatedAt)
	return a, err
}

// List returns up to limit assets after the cursor, ordered by (created_at, id)
// descending, plus the next cursor (nil when the last page is reached).
func (r *Repository) List(ctx context.Context, f ListFilter, cur *httpserver.Cursor, limit int) ([]Asset, *httpserver.Cursor, error) {
	var (
		conds []string
		args  []any
	)
	add := func(cond string, val any) {
		args = append(args, val)
		conds = append(conds, strings.ReplaceAll(cond, "?", "$"+itoa(len(args))))
	}

	if f.Countries != nil {
		add("(country = ANY(?) OR country IS NULL)", f.Countries)
	}
	if f.Site != "" {
		add("site = ?", f.Site)
	}
	if f.Status != "" {
		add("status = ?", f.Status)
	}
	if f.Query != "" {
		q := "%" + f.Query + "%"
		// One arg referenced by three placeholders — append once, build manually.
		args = append(args, q)
		p := "$" + itoa(len(args))
		conds = append(conds, "(asset_no ILIKE "+p+" OR make ILIKE "+p+" OR model ILIKE "+p+")")
	}
	if cur != nil {
		args = append(args, cur.CreatedAt)
		pTime := "$" + itoa(len(args))
		args = append(args, cur.ID)
		pID := "$" + itoa(len(args))
		conds = append(conds, "(created_at, id) < ("+pTime+", "+pID+"::uuid)")
	}

	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	args = append(args, limit+1) // fetch one extra to detect a next page
	sql := "SELECT " + selectCols + " FROM public.vehicle_fleet " + where +
		" ORDER BY created_at DESC, id DESC LIMIT $" + itoa(len(args))

	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	out := make([]Asset, 0, limit)
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	var next *httpserver.Cursor
	if len(out) > limit {
		last := out[limit-1]
		next = &httpserver.Cursor{CreatedAt: last.CreatedAt, ID: last.ID}
		out = out[:limit]
	}
	return out, next, nil
}

// ErrNotFound indicates no asset with the given id (within scope).
var ErrNotFound = errors.New("asset not found")

// Get returns a single asset by id, honoring country scope.
func (r *Repository) Get(ctx context.Context, id string, countries []string) (*Asset, error) {
	args := []any{id}
	scope := ""
	if countries != nil {
		args = append(args, countries)
		scope = " AND (country = ANY($2) OR country IS NULL)"
	}
	sql := "SELECT " + selectCols + " FROM public.vehicle_fleet WHERE id = $1" + scope
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, ErrNotFound
	}
	a, err := scanAsset(rows)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// Handler serves asset endpoints.
type Handler struct {
	repo     *Repository
	identity *identity.Repository
}

// NewHandler constructs a Handler.
func NewHandler(repo *Repository, identityRepo *identity.Repository) *Handler {
	return &Handler{repo: repo, identity: identityRepo}
}

// scopeFor resolves the caller's authorization scope and enforces account
// status. Returns the scope, or writes an error response and returns nil.
func (h *Handler) scopeFor(w http.ResponseWriter, r *http.Request) *identity.Scope {
	p := auth.PrincipalFromContext(r.Context())
	if p == nil {
		httpserver.WriteError(w, http.StatusUnauthorized, httpserver.CodeUnauthorized, "Authentication required.")
		return nil
	}
	scope, err := h.identity.GetScope(r.Context(), p.UserID)
	if errors.Is(err, identity.ErrProfileNotFound) {
		httpserver.WriteError(w, http.StatusForbidden, httpserver.CodeForbidden, "No profile for this account.")
		return nil
	}
	if err != nil {
		httpserver.WriteError(w, http.StatusInternalServerError, httpserver.CodeInternal, "Could not resolve access.")
		return nil
	}
	if scope.Locked || !scope.Approved {
		httpserver.WriteError(w, http.StatusForbidden, httpserver.CodeForbidden, "Account is not active.")
		return nil
	}
	return scope
}

// countryScope returns nil for elevated roles (unrestricted) or the caller's
// countries otherwise.
func countryScope(scope *identity.Scope) []string {
	if authorization.IsElevated(scope.Role) {
		return nil
	}
	if scope.Countries == nil {
		return []string{} // restrict to nothing rather than leak on misconfig
	}
	return scope.Countries
}

// List handles GET /api/v1/assets.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	scope := h.scopeFor(w, r)
	if scope == nil {
		return
	}
	cur, err := httpserver.DecodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		httpserver.WriteError(w, http.StatusBadRequest, httpserver.CodeBadRequest, "Invalid cursor.")
		return
	}
	limit := httpserver.ParseLimit(r)
	f := ListFilter{
		Countries: countryScope(scope),
		Site:      r.URL.Query().Get("site"),
		Status:    r.URL.Query().Get("status"),
		Query:     r.URL.Query().Get("q"),
	}
	items, next, err := h.repo.List(r.Context(), f, cur, limit)
	if err != nil {
		httpserver.WriteError(w, http.StatusInternalServerError, httpserver.CodeInternal, "Could not list assets.")
		return
	}
	page := httpserver.Page{Items: items}
	if next != nil {
		page.NextCursor = next.Encode()
	}
	httpserver.WriteJSON(w, http.StatusOK, page, map[string]int{"limit": limit})
}

// Get handles GET /api/v1/assets/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	scope := h.scopeFor(w, r)
	if scope == nil {
		return
	}
	id := chi.URLParam(r, "id")
	asset, err := h.repo.Get(r.Context(), id, countryScope(scope))
	if errors.Is(err, ErrNotFound) {
		httpserver.WriteError(w, http.StatusNotFound, httpserver.CodeNotFound, "Asset not found.")
		return
	}
	if err != nil {
		httpserver.WriteError(w, http.StatusInternalServerError, httpserver.CodeInternal, "Could not load asset.")
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, asset, nil)
}

// itoa is a tiny dependency-free int->string for building positional params.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
