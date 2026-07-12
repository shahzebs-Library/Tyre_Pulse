import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted chainable Supabase mock (records table + filters + payloads), plus a
// storage stub for the photo-upload path. Mirrors accidentsPage.api.test.js.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, storage: { upload: null, publicPath: null } }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols) { calls.select = cols; return b },
      order() { return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  const storage = {
    from() {
      return {
        upload(path, file, opts) { state.storage.upload = { path, file, opts }; return Promise.resolve({ data: { path }, error: null }) },
        getPublicUrl(path) { state.storage.publicPath = path; return { data: { publicUrl: `https://cdn.test/${path}` } } },
      }
    },
  }
  return { state, supabase: { from, storage } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const cl = await import('../lib/api/checklists')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.storage = { upload: null, publicPath: null }
})

describe('checklists service layer', () => {
  it('listTemplates scopes by status and country (null-inclusive)', async () => {
    h.state.result = { data: [{ id: 't1', name: 'Safety' }], error: null }
    const out = await cl.listTemplates({ status: 'published', country: 'KSA' })
    expect(h.state.last._table).toBe('checklist_templates')
    expect(h.state.last._calls.eq).toContainEqual(['status', 'published'])
    expect(h.state.last._calls.or[0]).toMatch(/country\.eq\.KSA/)
    expect(out).toEqual([{ id: 't1', name: 'Safety' }])
  })

  it('createTemplate builds a clean payload with embedded fields', async () => {
    h.state.result = { data: { id: 'new' }, error: null }
    const fields = [{ id: 'a', type: 'text', label: 'Name' }]
    await cl.createTemplate({ name: 'Daily', require_signature: true, fields })
    const ins = h.state.last._calls.insert
    expect(ins.name).toBe('Daily')
    expect(ins.status).toBe('draft')
    expect(ins.require_signature).toBe(true)
    expect(ins.require_approval).toBe(false)
    expect(ins.fields).toEqual(fields)
  })

  it('createSubmission defaults status to submitted and carries answers/photos', async () => {
    h.state.result = { data: { id: 's1' }, error: null }
    await cl.createSubmission({ template_id: 't1', answers: { a: 'x' }, photos: { a: ['u'] }, signature_data: 'data:png' })
    const ins = h.state.last._calls.insert
    expect(ins.template_id).toBe('t1')
    expect(ins.status).toBe('submitted')
    expect(ins.answers).toEqual({ a: 'x' })
    expect(ins.photos).toEqual({ a: ['u'] })
    expect(ins.signature_data).toBe('data:png')
  })

  it('publishTemplate/archiveTemplate update status', async () => {
    h.state.result = { data: { id: 't1', status: 'published' }, error: null }
    await cl.publishTemplate('t1')
    expect(h.state.last._calls.update).toEqual({ status: 'published' })
    await cl.archiveTemplate('t1')
    expect(h.state.last._calls.update).toEqual({ status: 'archived' })
  })

  it('uploadChecklistPhoto stores under a checklists/ prefix and returns a public URL', async () => {
    const file = { name: 'shot.JPG', type: 'image/jpeg' }
    const url = await cl.uploadChecklistPhoto(file, { prefix: 'sub1_fieldA' })
    expect(h.state.storage.upload.path).toMatch(/^checklists\/sub1_fieldA\/\d+_[a-z0-9]+\.jpg$/)
    expect(url).toMatch(/^https:\/\/cdn\.test\/checklists\/sub1_fieldA\//)
  })

  it('uploadChecklistPhoto rejects a missing file', async () => {
    await expect(cl.uploadChecklistPhoto(null, {})).rejects.toThrow(/no file/i)
  })
})
