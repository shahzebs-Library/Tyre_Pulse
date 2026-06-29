package httpserver

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestCursorRoundTrip(t *testing.T) {
	c := Cursor{CreatedAt: time.Date(2026, 6, 29, 10, 0, 0, 0, time.UTC), ID: "abc-123"}
	token := c.Encode()
	if token == "" {
		t.Fatal("empty token")
	}
	got, err := DecodeCursor(token)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got == nil || got.ID != c.ID || !got.CreatedAt.Equal(c.CreatedAt) {
		t.Errorf("round-trip mismatch: got %+v want %+v", got, c)
	}
}

func TestDecodeCursor_Empty(t *testing.T) {
	c, err := DecodeCursor("")
	if err != nil || c != nil {
		t.Errorf("empty token should yield (nil,nil), got (%v,%v)", c, err)
	}
}

func TestDecodeCursor_Invalid(t *testing.T) {
	if _, err := DecodeCursor("!!!not-base64!!!"); err == nil {
		t.Error("expected error for malformed cursor")
	}
}

func TestParseLimit(t *testing.T) {
	cases := map[string]int{
		"":     DefaultPageLimit,
		"0":    DefaultPageLimit,
		"-5":   DefaultPageLimit,
		"abc":  DefaultPageLimit,
		"25":   25,
		"5000": MaxPageLimit,
	}
	for q, want := range cases {
		r := httptest.NewRequest("GET", "/x?limit="+q, nil)
		if got := ParseLimit(r); got != want {
			t.Errorf("ParseLimit(limit=%q) = %d, want %d", q, got, want)
		}
	}
}
