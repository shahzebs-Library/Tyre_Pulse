// Package auth validates Supabase-issued JWTs (Phase A) and carries the
// authenticated principal through the request context.
//
// In Phase A the Go API does not issue tokens — Supabase Auth (GoTrue) does.
// The API verifies the bearer token's HS256 signature with the project JWT
// secret, then loads the principal's role and scope from Postgres. A later
// phase can switch to asymmetric JWKS verification without changing callers.
package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	// ErrMissingToken is returned when no bearer token is present.
	ErrMissingToken = errors.New("missing bearer token")
	// ErrInvalidToken is returned when the token fails verification.
	ErrInvalidToken = errors.New("invalid or expired token")
)

// Principal is the authenticated caller as derived from a verified JWT.
// Role and scope are enriched from the database by the identity layer; the
// token alone only establishes identity (the subject/user id) and email.
type Principal struct {
	UserID string
	Email  string
	Role   string // enriched from profiles; empty until loaded
}

type ctxKey string

const principalKey ctxKey = "principal"

// Verifier verifies Supabase JWTs using the shared HS256 secret.
type Verifier struct {
	secret []byte
}

// NewVerifier builds a Verifier from the Supabase JWT secret.
func NewVerifier(secret string) *Verifier {
	return &Verifier{secret: []byte(secret)}
}

// Verify parses and validates a raw JWT string, returning the principal it
// identifies. It enforces the HS256 algorithm and standard expiry claims.
func (v *Verifier) Verify(raw string) (*Principal, error) {
	if raw == "" {
		return nil, ErrMissingToken
	}
	token, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return v.secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithLeeway(30*time.Second))
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, ErrInvalidToken
	}
	email, _ := claims["email"].(string)
	return &Principal{UserID: sub, Email: email}, nil
}

// WithPrincipal stores the principal on the context.
func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

// PrincipalFromContext returns the authenticated principal, or nil if none.
func PrincipalFromContext(ctx context.Context) *Principal {
	if p, ok := ctx.Value(principalKey).(*Principal); ok {
		return p
	}
	return nil
}
