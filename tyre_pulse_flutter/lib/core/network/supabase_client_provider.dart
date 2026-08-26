/// The single Supabase client every repository reads.
///
/// # Why this file exists
///
/// `SupabaseClient` is what carries out the three things AGENTS.md rule 3
/// allows: a PostgREST call on a real table, a Postgres RPC, or an Edge
/// Function invocation. One client, one provider, so a repository never
/// constructs its own and two repositories never disagree about which
/// session they are using.
///
/// # Ordering this depends on
///
/// `Supabase.instance` throws until `initializeSupabase`
/// (`supabase_bootstrap.dart`) has completed. That is deliberate: a
/// repository reading this provider before bootstrap has run is a genuine
/// startup-ordering bug, and the loud, immediate throw an uninitialised
/// `Supabase.instance` produces is the correct way to surface it - swallowing
/// it here would hide the ordering mistake behind a provider that quietly
/// never resolves.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The application's one [SupabaseClient].
///
/// Every other lane reads this provider directly; do not construct a second
/// client anywhere.
final Provider<SupabaseClient> supabaseClientProvider =
    Provider<SupabaseClient>((ref) => Supabase.instance.client);
