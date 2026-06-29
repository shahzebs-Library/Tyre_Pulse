// Package authorization centralises role and scope checks. Every request is
// authorized server-side here — client-side role checks are UX only and are
// never the security boundary.
package authorization

// Role constants mirror the canonical role set used across the platform.
const (
	RoleAdmin     = "admin"
	RoleManager   = "manager"
	RoleDirector  = "director"
	RoleInspector = "inspector"
	RoleTyreMan   = "tyre_man"
	RoleReporter  = "reporter"
	RoleDriver    = "driver"
)

// elevated roles may perform management-level actions.
var elevated = map[string]struct{}{
	RoleAdmin:    {},
	RoleManager:  {},
	RoleDirector: {},
}

// Normalize coerces a stored role label (e.g. "Tyre Man") into the canonical
// lowercase snake_case form, mirroring the DB app_role() helper.
func Normalize(raw string) string {
	out := make([]rune, 0, len(raw))
	for _, r := range raw {
		switch {
		case r >= 'A' && r <= 'Z':
			out = append(out, r+('a'-'A'))
		case r == ' ' || r == '-':
			out = append(out, '_')
		default:
			out = append(out, r)
		}
	}
	role := string(out)
	switch role {
	case RoleAdmin, RoleManager, RoleDirector, RoleInspector, RoleTyreMan, RoleReporter, RoleDriver:
		return role
	default:
		return RoleReporter
	}
}

// IsElevated reports whether the role has management privileges.
func IsElevated(role string) bool {
	_, ok := elevated[Normalize(role)]
	return ok
}

// HasRole reports whether the role is in the allowed set (normalized).
func HasRole(role string, allowed ...string) bool {
	n := Normalize(role)
	for _, a := range allowed {
		if n == Normalize(a) {
			return true
		}
	}
	return false
}
