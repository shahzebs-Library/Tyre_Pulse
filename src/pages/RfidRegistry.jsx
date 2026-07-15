import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radio, Tag, Truck, MapPin, AlertCircle, CheckCircle,
  X, Plus, Search, Filter, RefreshCw, Edit, Trash2,
  Eye, Calendar, Package, Battery, Signal, Activity,
  ChevronRight, ChevronDown, Download, Upload,
  BarChart3, Clock, Shield, Wrench, Loader2, History,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import RfidScanner from '../components/RfidScanner'

const STATUS_COLORS = {
  available: 'text-blue-400 bg-blue-400/15 border-blue-400/30',
  assigned: 'text-yellow-400 bg-yellow-400/15 border-yellow-400/30',
  attached: 'text-green-400 bg-green-400/15 border-green-400/30',
  removed: 'text-gray-400 bg-gray-400/15 border-gray-400/30',
  lost: 'text-red-400 bg-red-400/15 border-red-400/30',
  damaged: 'text-purple-400 bg-purple-400/15 border-purple-400/30',
}

const SEVERITY_COLORS = {
  low: 'text-gray-400 bg-gray-400/15',
  medium: 'text-yellow-400 bg-yellow-400/15',
  high: 'text-orange-400 bg-orange-400/15',
  critical: 'text-red-400 bg-red-400/15',
}

const TAB_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'tags', label: 'Tag Inventory', icon: Tag },
  { id: 'readers', label: 'Readers/Zones', icon: MapPin },
  { id: 'alerts', label: 'Alerts', icon: AlertCircle },
  { id: 'history', label: 'Read History', icon: History },
]

export default function RfidRegistry() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  // Dashboard data
  const [stats, setStats] = useState({
    totalTags: 0,
    attachedTags: 0,
    availableTags: 0,
    lostTags: 0,
    damagedTags: 0,
    activeReaders: 0,
    totalReaders: 0,
    alertsOpen: 0,
    alertsToday: 0,
  })

  // Tag inventory data
  const [tags, setTags] = useState([])
  const [tagsSearch, setTagsSearch] = useState('')
  const [tagsFilter, setTagsFilter] = useState('all')
  const [tagsSiteFilter, setTagsSiteFilter] = useState('all')
  const [sites, setSites] = useState([])

  // Readers data
  const [readers, setReaders] = useState([])
  const [readersSearch, setReadersSearch] = useState('')

  // Alerts data
  const [alerts, setAlerts] = useState([])
  const [alertsFilter, setAlertsFilter] = useState('open')

  // History data
  const [history, setHistory] = useState([])
  const [historySearch, setHistorySearch] = useState('')

  // Tag form state
  const [showTagForm, setShowTagForm] = useState(false)
  const [editingTag, setEditingTag] = useState(null)
  const [tagFormData, setTagFormData] = useState({
    tag_uid: '',
    tag_epc: '',
    tag_type: 'UHF',
    manufacturer: '',
    site: '',
  })

  useEffect(() => {
    loadData()
  }, [activeTab])

  async function loadData() {
    setLoading(true)
    try {
      // Load stats
      const { data: tagStats } = await supabase.from('rfid_tags').select('status')
      const { data: readerStats } = await supabase.from('rfid_readers').select('status')
      const { data: alertStats } = await supabase
        .from('rfid_alerts')
        .select('created_at')
        .is('resolved_at', null)

      setStats({
        totalTags: tagStats?.length || 0,
        attachedTags: tagStats?.filter(t => t.status === 'attached').length || 0,
        availableTags: tagStats?.filter(t => t.status === 'available').length || 0,
        lostTags: tagStats?.filter(t => t.status === 'lost').length || 0,
        damagedTags: tagStats?.filter(t => t.status === 'damaged').length || 0,
        activeReaders: readerStats?.filter(r => r.status === 'active').length || 0,
        totalReaders: readerStats?.length || 0,
        alertsOpen: alertStats?.length || 0,
        alertsToday: alertStats?.filter(a => 
          new Date(a.created_at).toDateString() === new Date().toDateString()
        ).length || 0,
      })

      // Load tags with tyre info
      if (activeTab === 'tags' || activeTab === 'dashboard') {
        const { data: tyreTags } = await supabase
          .from('rfid_tags')
          .select(`
            *,
            tyre_records!left(id, serial_no, asset_no, brand, site, status)
          `)
          .order('created_at', { ascending: false })
          .limit(500)
        setTags(tyreTags || [])
        
        // Get unique sites
        const tagSites = [...new Set((tyreTags || []).map(t => t.site).filter(Boolean))].sort()
        setSites(tagSites)
      }

      // Load readers
      if (activeTab === 'readers' || activeTab === 'dashboard') {
        const { data: readerData } = await supabase
          .from('rfid_readers')
          .select('*')
          .order('site')
          .order('zone_name')
        setReaders(readerData || [])
      }

      // Load alerts
      if (activeTab === 'alerts' || activeTab === 'dashboard') {
        const { data: alertData } = await supabase
          .from('rfid_alerts')
          .select(`
            *,
            rfid_tags!left(tag_uid)
          `)
          .is('resolved_at', alertsFilter === 'open' ? null : undefined)
          .order('created_at', { ascending: false })
          .limit(100)
        setAlerts(alertData || [])
      }

      // Load history
      if (activeTab === 'history') {
        const { data: historyData } = await supabase
          .from('rfid_read_events')
          .select(`
            *,
            rfid_readers!left(name, zone_name)
          `)
          .order('read_at', { ascending: false })
          .limit(200)
        setHistory(historyData || [])
      }

      setLastUpdated(new Date())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadData()
  }

  // Filter tags
  const filteredTags = useMemo(() => {
    return tags.filter(t => {
      const searchMatch = !tagsSearch || 
        t.tag_uid?.toLowerCase().includes(tagsSearch.toLowerCase()) ||
        t.tyre_records?.serial_no?.toLowerCase().includes(tagsSearch.toLowerCase()) ||
        t.tyre_records?.asset_no?.toLowerCase().includes(tagsSearch.toLowerCase()) ||
        t.manufacturer?.toLowerCase().includes(tagsSearch.toLowerCase())
      
      const statusMatch = tagsFilter === 'all' || t.status === tagsFilter
      const siteMatch = tagsSiteFilter === 'all' || t.site === tagsSiteFilter
      
      return searchMatch && statusMatch && siteMatch
    })
  }, [tags, tagsSearch, tagsFilter, tagsSiteFilter])

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    if (alertsFilter === 'open') {
      return alerts.filter(a => !a.resolved_at)
    }
    return alerts
  }, [alerts, alertsFilter])

  // Tag form handlers
  function openTagForm(tag = null) {
    setEditingTag(tag)
    setTagFormData({
      tag_uid: tag?.tag_uid || '',
      tag_epc: tag?.tag_epc || '',
      tag_type: tag?.tag_type || 'UHF',
      manufacturer: tag?.manufacturer || '',
      site: tag?.site || '',
    })
    setShowTagForm(true)
  }

  function closeTagForm() {
    setShowTagForm(false)
    setEditingTag(null)
    setTagFormData({
      tag_uid: '',
      tag_epc: '',
      tag_type: 'UHF',
      manufacturer: '',
      site: '',
    })
  }

  async function saveTag() {
    if (!tagFormData.tag_uid) return

    const tagData = {
      ...tagFormData,
      status: 'available',
      assigned_at: editingTag ? tagFormData.assigned_at : null,
      attached_at: editingTag ? tagFormData.attached_at : null,
    }

    if (editingTag) {
      await supabase.from('rfid_tags').update(tagData).eq('id', editingTag.id)
    } else {
      await supabase.from('rfid_tags').insert(tagData)
    }

    closeTagForm()
    loadData()
  }

  async function deleteTag(tagId) {
    if (confirm('Delete this RFID tag?')) {
      await supabase.from('rfid_tags').delete().eq('id', tagId)
      loadData()
    }
  }

  async function resolveAlert(alertId) {
    await supabase.from('rfid_alerts').update({ resolved_at: new Date() }).eq('id', alertId)
    loadData()
  }

  function handleScannerResult(result) {
    // Handle scanner result - navigate or update
    if (result?.tyre) {
      // Could assign RFID to tyre here
      openTagForm({ ...result.tyre, tyre_record_id: result.tyre.id })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFID Registry"
        subtitle="Advanced tyre tracking with RFID tags, zone monitoring, and real-time alerts"
        icon={Radio}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        updatedAt={lastUpdated}
        actions={
          <button
            onClick={() => setScannerOpen(true)}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Radio size={14} /> Scan RFID Tag
          </button>
        }
      />

      {/* Tab Navigation */}
      <div className="flex gap-2 flex-wrap">
        {TAB_OPTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-brand-primary/20 border border-brand-primary/30 text-brand-bright'
                : 'bg-panel-deep border border-white/5 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-white">{stats.totalTags}</p>
              <p className="text-xs text-gray-500 mt-1">Total Tags</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{stats.attachedTags}</p>
              <p className="text-xs text-gray-500 mt-1">Attached</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">{stats.availableTags}</p>
              <p className="text-xs text-gray-500 mt-1">Available</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-red-400">{stats.lostTags}</p>
              <p className="text-xs text-gray-500 mt-1">Lost/Damaged</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{stats.activeReaders}/{stats.totalReaders}</p>
              <p className="text-xs text-gray-500 mt-1">Readers Active</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-yellow-400">{stats.alertsOpen}</p>
              <p className="text-xs text-gray-500 mt-1">Open Alerts</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Activity size={15} className="text-green-400" /> Quick Actions
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() => { setActiveTab('tags'); openTagForm() }}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-brand-primary/10 border border-brand-primary/20 hover:bg-brand-primary/20 transition-colors"
              >
                <Plus size={24} className="text-green-400" />
                <span className="text-xs font-medium text-white">Add Tag</span>
              </button>
              <button
                onClick={() => setScannerOpen(true)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-brand-primary/10 border border-brand-primary/20 hover:bg-brand-primary/20 transition-colors"
              >
                <Radio size={24} className="text-green-400" />
                <span className="text-xs font-medium text-white">Scan Tag</span>
              </button>
              <button
                onClick={() => setActiveTab('readers')}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
              >
                <MapPin size={24} className="text-blue-400" />
                <span className="text-xs font-medium text-white">Manage Zones</span>
              </button>
              <button
                onClick={() => setActiveTab('alerts')}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                <AlertCircle size={24} className="text-red-400" />
                <span className="text-xs font-medium text-white">View Alerts</span>
              </button>
            </div>
          </div>

          {/* Recent Alerts */}
          {alerts.filter(a => !a.resolved_at).slice(0, 5).length > 0 && (
            <div className="card p-0">
              <div className="px-4 py-3 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <AlertCircle size={15} className="text-red-400" /> Recent Alerts
                </h3>
              </div>
              <div className="divide-y divide-white/5">
                {alerts.filter(a => !a.resolved_at).slice(0, 5).map(alert => (
                  <div key={alert.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.medium}`}>
                        {alert.severity}
                      </span>
                      <span className="text-sm text-white">{alert.message}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {new Date(alert.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Tags Tab */}
      {activeTab === 'tags' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-52">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input pl-9 text-sm"
                placeholder="Search tags, serials, manufacturers..."
                value={tagsSearch}
                onChange={e => setTagsSearch(e.target.value)}
              />
            </div>
            <select className="input w-36 text-sm" value={tagsFilter} onChange={e => setTagsFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="available">Available</option>
              <option value="assigned">Assigned</option>
              <option value="attached">Attached</option>
              <option value="removed">Removed</option>
              <option value="lost">Lost</option>
              <option value="damaged">Damaged</option>
            </select>
            <select className="input w-36 text-sm" value={tagsSiteFilter} onChange={e => setTagsSiteFilter(e.target.value)}>
              <option value="all">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => openTagForm()} className="btn-primary flex items-center gap-1.5 text-sm">
              <Plus size={14} /> Add Tag
            </button>
          </div>

          {/* Tags Table */}
          <div className="card overflow-hidden p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">Loading tags...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] text-gray-500 uppercase" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <th className="px-4 py-3">Tag UID</th>
                      <th className="px-3 py-3">Type</th>
                      <th className="px-3 py-3">Tyre Serial</th>
                      <th className="px-3 py-3">Asset No</th>
                      <th className="px-3 py-3">Site</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Last Seen</th>
                      <th className="px-3 py-3 w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTags.map(tag => (
                      <tr key={tag.id} className="border-t border-white/5 hover:bg-white/2">
                        <td className="px-4 py-2.5 font-mono text-xs text-white">{tag.tag_uid}</td>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{tag.tag_type || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-300 text-xs">{tag.tyre_records?.serial_no || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-300 text-xs">{tag.tyre_records?.asset_no || '-'}</td>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{tag.site || '-'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[tag.status] || STATUS_COLORS.attached}`}>
                            {tag.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">
                          {tag.last_seen_at ? new Date(tag.last_seen_at).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openTagForm(tag)} className="p-1 text-gray-400 hover:text-white" title="Edit">
                              <Edit size={13} />
                            </button>
                            <button onClick={() => deleteTag(tag.id)} className="p-1 text-gray-400 hover:text-red-400" title="Delete">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredTags.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-gray-600">No RFID tags found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Readers/Zones Tab */}
      {activeTab === 'readers' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-52">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input pl-9 text-sm"
                placeholder="Search readers, zones..."
                value={readersSearch}
                onChange={e => setReadersSearch(e.target.value)}
              />
            </div>
            <button className="btn-primary flex items-center gap-1.5 text-sm">
              <Plus size={14} /> Add Reader
            </button>
          </div>

          {/* Readers Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {readers
              .filter(r => !readersSearch || r.name?.toLowerCase().includes(readersSearch.toLowerCase()) || r.zone_name?.toLowerCase().includes(readersSearch.toLowerCase()))
              .map(reader => (
                <div key={reader.id} className="card p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white">{reader.name}</h3>
                      <p className="text-xs text-gray-500">{reader.zone_name}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      reader.status === 'active' ? STATUS_COLORS.attached : 'text-gray-400 bg-gray-400/15'
                    }`}>
                      {reader.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-600">Type</p>
                      <p className="text-white">{reader.reader_type}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Site</p>
                      <p className="text-white">{reader.site || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Last Seen</p>
                      <p className="text-white">{reader.last_heartbeat ? new Date(reader.last_heartbeat).toLocaleTimeString() : '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Firmware</p>
                      <p className="text-white">{reader.firmware_version || '-'}</p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </motion.div>
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="flex gap-3 flex-wrap items-center">
            <select className="input w-36 text-sm" value={alertsFilter} onChange={e => setAlertsFilter(e.target.value)}>
              <option value="open">Open Alerts</option>
              <option value="all">All Alerts</option>
            </select>
            <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary flex items-center gap-1.5 text-xs">
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          <div className="card overflow-hidden p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">Loading alerts...</div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {filteredAlerts.length === 0 ? (
                  <div className="py-12 text-center text-gray-600">No alerts to display</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-panel-deep">
                      <tr className="text-left text-[10px] text-gray-500 uppercase" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th className="px-4 py-3">Severity</th>
                        <th className="px-3 py-3">Tag</th>
                        <th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3">Message</th>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3 w-16">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAlerts.map(alert => (
                        <tr key={alert.id} className="border-t border-white/5 hover:bg-white/2">
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${SEVERITY_COLORS[alert.severity]}`}>
                              {alert.severity}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-white">{alert.tag_uid}</td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{alert.alert_type.replace('_', ' ')}</td>
                          <td className="px-3 py-2.5 text-gray-300 text-xs">{alert.message}</td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{new Date(alert.created_at).toLocaleString()}</td>
                          <td className="px-3 py-2.5">
                            {!alert.resolved_at && (
                              <button
                                onClick={() => resolveAlert(alert.id)}
                                className="p-1 text-green-400 hover:text-green-300"
                                title="Resolve"
                              >
                                <CheckCircle size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Read History Tab */}
      {activeTab === 'history' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-52">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input pl-9 text-sm"
                placeholder="Search tag UID, zone..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
              />
            </div>
            <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary flex items-center gap-1.5 text-xs">
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          <div className="card overflow-hidden p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">Loading history...</div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel-deep">
                    <tr className="text-left text-[10px] text-gray-500 uppercase" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-3 py-3">Tag UID</th>
                      <th className="px-3 py-3">Zone</th>
                      <th className="px-3 py-3">RSSI</th>
                      <th className="px-3 py-3">Site</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history
                      .filter(h => !historySearch || h.tag_uid?.toLowerCase().includes(historySearch.toLowerCase()) || h.zone_name?.toLowerCase().includes(historySearch.toLowerCase()))
                      .map((read, idx) => (
                        <tr key={idx} className="border-t border-white/5 hover:bg-white/2">
                          <td className="px-4 py-2.5 text-gray-400 text-xs">{new Date(read.read_at).toLocaleString()}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-white">{read.tag_uid}</td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{read.rfid_readers?.zone_name || read.zone_name || '-'}</td>
                          <td className="px-3 py-2.5 text-xs">
                            {read.rssi ? (
                              <span className={`${read.rssi > -50 ? 'text-green-400' : read.rssi > -70 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {read.rssi} dBm
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{read.site || '-'}</td>
                        </tr>
                      ))}
                    {history.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-gray-600">No read events recorded</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Tag Form Modal */}
      <AnimatePresence>
        {showTagForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.8)' }}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="card max-w-md w-full p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">
                  {editingTag ? 'Edit RFID Tag' : 'Add New RFID Tag'}
                </h3>
                <button onClick={closeTagForm} className="p-1 text-gray-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Tag UID *</label>
                  <input
                    type="text"
                    className="input w-full mt-1"
                    value={tagFormData.tag_uid}
                    onChange={e => setTagFormData({ ...tagFormData, tag_uid: e.target.value })}
                    placeholder="Enter RFID tag UID"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">EPC Code</label>
                  <input
                    type="text"
                    className="input w-full mt-1"
                    value={tagFormData.tag_epc}
                    onChange={e => setTagFormData({ ...tagFormData, tag_epc: e.target.value })}
                    placeholder="Optional EPC code"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Tag Type</label>
                  <select
                    className="input w-full mt-1"
                    value={tagFormData.tag_type}
                    onChange={e => setTagFormData({ ...tagFormData, tag_type: e.target.value })}
                  >
                    <option value="UHF">UHF</option>
                    <option value="HF">HF</option>
                    <option value="NFC">NFC</option>
                    <option value="Barcode">Barcode</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Manufacturer</label>
                  <input
                    type="text"
                    className="input w-full mt-1"
                    value={tagFormData.manufacturer}
                    onChange={e => setTagFormData({ ...tagFormData, manufacturer: e.target.value })}
                    placeholder="e.g. Impinj, Zebra"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Site</label>
                  <input
                    type="text"
                    className="input w-full mt-1"
                    value={tagFormData.site}
                    onChange={e => setTagFormData({ ...tagFormData, site: e.target.value })}
                    placeholder="Assign to site"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={closeTagForm} className="flex-1 btn-secondary">Cancel</button>
                <button onClick={saveTag} className="flex-1 btn-primary" disabled={!tagFormData.tag_uid}>
                  Save Tag
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RFID Scanner Modal */}
      <AnimatePresence>
        {scannerOpen && (
          <RfidScanner onClose={() => setScannerOpen(false)} onResult={handleScannerResult} />
        )}
      </AnimatePresence>
    </div>
  )
}