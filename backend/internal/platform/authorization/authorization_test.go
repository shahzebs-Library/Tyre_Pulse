package authorization

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"Admin":     RoleAdmin,
		"Tyre Man":  RoleTyreMan,
		"tyre-man":  RoleTyreMan,
		"DIRECTOR":  RoleDirector,
		"reporter":  RoleReporter,
		"weird-role": RoleReporter, // unknown falls back to reporter
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsElevated(t *testing.T) {
	for _, r := range []string{"Admin", "manager", "Director"} {
		if !IsElevated(r) {
			t.Errorf("expected %q to be elevated", r)
		}
	}
	for _, r := range []string{"inspector", "Tyre Man", "reporter", "driver"} {
		if IsElevated(r) {
			t.Errorf("expected %q to NOT be elevated", r)
		}
	}
}

func TestHasRole(t *testing.T) {
	if !HasRole("Tyre Man", "admin", "tyre_man") {
		t.Error("expected Tyre Man to match tyre_man")
	}
	if HasRole("reporter", "admin", "manager") {
		t.Error("reporter should not match admin/manager")
	}
}
