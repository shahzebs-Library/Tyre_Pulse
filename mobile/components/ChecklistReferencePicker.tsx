/**
 * ChecklistReferencePicker
 *
 * A live reference-field picker for the mobile checklist fill screen. Renders a
 * pressable "field" row that opens a searchable modal backed by live reference
 * data (Assets / Sites / Users) loaded on first open via listReferenceOptions.
 *
 * Off-list values are never blocked: a "Use \"{typed}\"" fallback row lets the
 * operator commit free text, and a Clear affordance resets the value. Options
 * are cached in state after the first successful load; failures surface an
 * inline retry row. Self-contained and themed to match the app (#16a34a).
 */
import { useCallback, useMemo, useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, Pressable,
  FlatList, StyleSheet, ActivityIndicator, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ReferenceSource } from '../lib/checklistFields'
import { listReferenceOptions } from '../lib/checklists'

interface Props {
  source: ReferenceSource
  value?: string
  onChange: (v: string) => void
  country?: string | null
  placeholder?: string
}

const SOURCE_META: Record<ReferenceSource, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  asset: { icon: 'car-outline', label: 'Asset' },
  site: { icon: 'business-outline', label: 'Site' },
  user: { icon: 'person-outline', label: 'User' },
}

export default function ChecklistReferencePicker({
  source, value, onChange, country, placeholder,
}: Props) {
  const meta = SOURCE_META[source] ?? SOURCE_META.asset

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = typeof value === 'string' ? value : ''

  const loadOptions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const opts = await listReferenceOptions(source, country)
      setOptions(Array.isArray(opts) ? opts : [])
    } catch (e: any) {
      setError(e?.message || `Could not load ${meta.label.toLowerCase()} options.`)
    } finally {
      setLoading(false)
    }
  }, [source, country, meta.label])

  const handleOpen = useCallback(() => {
    setOpen(true)
    setSearch('')
    // Load once (or after a prior failure) — cached across re-opens otherwise.
    if (options == null && !loading) loadOptions()
  }, [options, loading, loadOptions])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  const commit = useCallback((v: string) => {
    onChange(v)
    setOpen(false)
  }, [onChange])

  const query = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    const list = options ?? []
    if (!query) return list
    return list.filter(o => o.toLowerCase().includes(query))
  }, [options, query])

  const typed = search.trim()
  // Offer the free-typed fallback only when it isn't already an exact option.
  const showFreeType = typed.length > 0
    && !(options ?? []).some(o => o.toLowerCase() === typed.toLowerCase())

  return (
    <>
      <TouchableOpacity
        style={styles.field}
        onPress={handleOpen}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <Ionicons name={meta.icon} size={18} color="#16a34a" />
        <Text
          style={[styles.fieldValue, !current && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {current || placeholder || `Select a ${meta.label.toLowerCase()}…`}
        </Text>
        {!!current && (
          <TouchableOpacity
            onPress={() => onChange('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Clear selection"
          >
            <Ionicons name="close-circle" size={18} color="#cbd5e1" />
          </TouchableOpacity>
        )}
        <Ionicons name="chevron-down" size={18} color="#94a3b8" />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={handleClose}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Ionicons name={meta.icon} size={18} color="#16a34a" />
              <Text style={styles.headerTitle}>Select {meta.label}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color="#94a3b8" />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={`Search ${meta.label.toLowerCase()}…`}
              placeholderTextColor="#94a3b8"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#cbd5e1" />
              </TouchableOpacity>
            )}
          </View>

          {!!current && (
            <TouchableOpacity style={styles.clearRow} onPress={() => commit('')} activeOpacity={0.7}>
              <Ionicons name="backspace-outline" size={16} color="#dc2626" />
              <Text style={styles.clearText}>Clear selection</Text>
            </TouchableOpacity>
          )}

          {loading ? (
            <View style={styles.stateWrap}>
              <ActivityIndicator size="small" color="#16a34a" />
              <Text style={styles.stateText}>Loading {meta.label.toLowerCase()}s…</Text>
            </View>
          ) : error ? (
            <View style={styles.stateWrap}>
              <Ionicons name="cloud-offline-outline" size={30} color="#fca5a5" />
              <Text style={styles.stateText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={loadOptions} activeOpacity={0.85}>
                <Ionicons name="refresh" size={15} color="#fff" />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              style={styles.list}
              data={filtered}
              keyExtractor={(item, i) => `${item}-${i}`}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const active = item === current
                return (
                  <TouchableOpacity
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => commit(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={meta.icon}
                      size={18}
                      color={active ? '#16a34a' : '#64748b'}
                    />
                    <Text
                      style={[styles.rowText, active && styles.rowTextActive]}
                      numberOfLines={1}
                    >
                      {item}
                    </Text>
                    {active && <Ionicons name="checkmark-circle" size={20} color="#16a34a" />}
                  </TouchableOpacity>
                )
              }}
              ListHeaderComponent={
                showFreeType ? (
                  <TouchableOpacity
                    style={styles.freeTypeRow}
                    onPress={() => commit(typed)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="create-outline" size={18} color="#16a34a" />
                    <Text style={styles.freeTypeText} numberOfLines={1}>
                      Use “{typed}”
                    </Text>
                  </TouchableOpacity>
                ) : null
              }
              ListEmptyComponent={
                showFreeType ? null : (
                  <View style={styles.stateWrap}>
                    <Ionicons name="search-outline" size={28} color="#cbd5e1" />
                    <Text style={styles.stateText}>
                      {query ? 'No matches found.' : `No ${meta.label.toLowerCase()}s available.`}
                    </Text>
                  </View>
                )
              }
            />
          )}
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12,
  },
  fieldValue: { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '600' },
  fieldPlaceholder: { color: '#94a3b8', fontWeight: '400' },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#e2e8f0', marginBottom: 10,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a', paddingVertical: 0 },

  clearRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 2, marginTop: 4,
  },
  clearText: { fontSize: 13, fontWeight: '700', color: '#dc2626' },

  list: { marginTop: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12,
    marginBottom: 2,
  },
  rowActive: { backgroundColor: 'rgba(22,163,74,0.08)' },
  rowText: { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '500' },
  rowTextActive: { color: '#15803d', fontWeight: '700' },

  freeTypeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12,
    marginBottom: 6,
    backgroundColor: 'rgba(22,163,74,0.06)',
    borderWidth: 1, borderColor: 'rgba(22,163,74,0.25)', borderStyle: 'dashed',
  },
  freeTypeText: { flex: 1, fontSize: 14, color: '#15803d', fontWeight: '700' },

  stateWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  stateText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 18, maxWidth: 280 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
    backgroundColor: '#16a34a', borderRadius: 10, paddingHorizontal: 16, height: 40,
    justifyContent: 'center',
  },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
})
