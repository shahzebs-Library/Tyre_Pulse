package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-supabase-jwt-secret-value-0123456789"

func signToken(t *testing.T, claims jwt.MapClaims, method jwt.SigningMethod, secret []byte) string {
	t.Helper()
	tok := jwt.NewWithClaims(method, claims)
	s, err := tok.SignedString(secret)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return s
}

func TestVerify_ValidToken(t *testing.T) {
	v := NewVerifier(testSecret)
	raw := signToken(t, jwt.MapClaims{
		"sub":   "11111111-1111-1111-1111-111111111111",
		"email": "inspector@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	}, jwt.SigningMethodHS256, []byte(testSecret))

	p, err := v.Verify(raw)
	if err != nil {
		t.Fatalf("expected valid token, got error: %v", err)
	}
	if p.UserID != "11111111-1111-1111-1111-111111111111" {
		t.Errorf("unexpected user id: %q", p.UserID)
	}
	if p.Email != "inspector@example.com" {
		t.Errorf("unexpected email: %q", p.Email)
	}
}

func TestVerify_MissingToken(t *testing.T) {
	v := NewVerifier(testSecret)
	if _, err := v.Verify(""); err != ErrMissingToken {
		t.Errorf("expected ErrMissingToken, got %v", err)
	}
}

func TestVerify_WrongSecret(t *testing.T) {
	v := NewVerifier(testSecret)
	raw := signToken(t, jwt.MapClaims{
		"sub": "abc",
		"exp": time.Now().Add(time.Hour).Unix(),
	}, jwt.SigningMethodHS256, []byte("a-different-secret-value-entirely-x"))
	if _, err := v.Verify(raw); err != ErrInvalidToken {
		t.Errorf("expected ErrInvalidToken for wrong secret, got %v", err)
	}
}

func TestVerify_Expired(t *testing.T) {
	v := NewVerifier(testSecret)
	raw := signToken(t, jwt.MapClaims{
		"sub": "abc",
		"exp": time.Now().Add(-2 * time.Hour).Unix(),
	}, jwt.SigningMethodHS256, []byte(testSecret))
	if _, err := v.Verify(raw); err != ErrInvalidToken {
		t.Errorf("expected ErrInvalidToken for expired token, got %v", err)
	}
}

func TestVerify_NoneAlgorithmRejected(t *testing.T) {
	v := NewVerifier(testSecret)
	// Construct an unsigned ("alg: none") token — must be rejected.
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"sub": "abc",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	raw, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none token: %v", err)
	}
	if _, err := v.Verify(raw); err != ErrInvalidToken {
		t.Errorf("expected ErrInvalidToken for alg=none, got %v", err)
	}
}

func TestVerify_MissingSubject(t *testing.T) {
	v := NewVerifier(testSecret)
	raw := signToken(t, jwt.MapClaims{
		"email": "x@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	}, jwt.SigningMethodHS256, []byte(testSecret))
	if _, err := v.Verify(raw); err != ErrInvalidToken {
		t.Errorf("expected ErrInvalidToken for missing sub, got %v", err)
	}
}
