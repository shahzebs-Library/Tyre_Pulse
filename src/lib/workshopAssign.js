/**
 * workshopAssign.js - pure engine for SMART SKILL-BASED technician assignment in
 * Workshop Live Control. NO I/O. Given an open job and the current board, it
 * ranks technicians 0..100 so a foreman sees WHO to assign and WHY.
 *
 * Score (max 100):
 *   - skill match   40  job.required_skill / job.work_type vs the tech's skills
 *   - availability  30  AVAILABLE best, WAITING mid, WORKING low; OFF/ABSENT out
 *   - workload      20  fewer active assignments is better
 *   - site match    10  tech at the job's site
 *
 * Honest: when NO skill data exists (nobody has skills recorded) OR the job has
 * no derivable required skill, the skill component is NEUTRAL for everyone (half
 * weight) - it never fakes a confident match. Off-duty / absent techs are
 * excluded entirely. Deterministic: ties break by workload then name.
 */

import { STATUS } from './workshopLive'
import { skillById } from './technicianScorecard'

// ── Weights ─────────────────────────────────────────────────────────────────
const W_SKILL = 40
const W_AVAIL = 30
const W_WORKLOAD = 20
const W_SITE = 10

const arr = (v) => (Array.isArray(v) ? v : [])

/** Availability sub-score by live status (excluded statuses handled by caller). */
const AVAIL_SCORE = {
  [STATUS.AVAILABLE]: W_AVAIL,
  [STATUS.AWAITING_INSPECTION]: 18,
  [STATUS.WAITING_PARTS]: 15,
  [STATUS.WAITING_APPROVAL]: 15,
  [STATUS.WAITING_TOOLS]: 15,
  [STATUS.WAITING_VEHICLE]: 15,
  [STATUS.WORKING]: 6,
  [STATUS.ON_BREAK]: 3,
  [STATUS.TRAINING]: 3,
  [STATUS.OVERTIME]: 4,
}

/** Statuses that make a technician ineligible to take new work. */
const EXCLUDED = new Set([STATUS.OFF_DUTY, STATUS.ABSENT])

const STOPWORDS = new Set(['and', 'or', 'of', 'the', 'a', 'to', 'for', 'with', '&', 'job', 'work'])

/** Tokenize free text into meaningful lowercase words. */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

/** All tokens a tech's skill string implies (raw string + catalogue name if id). */
function skillTokens(skill) {
  const raw = String(skill || '')
  const cat = skillById(raw)
  const tokens = tokenize(raw)
  if (cat?.name) tokens.push(...tokenize(cat.name))
  return tokens
}

/** A readable label for a skill string (catalogue name when the id is known). */
function skillLabel(skill) {
  const cat = skillById(String(skill || ''))
  return cat?.name || String(skill || '').replace(/_/g, ' ')
}

/** Derive the required-skill text for a job (explicit field, else work type). */
function requiredSkillText(job) {
  return job?.required_skill || job?.skill || job?.work_type || ''
}

/**
 * Rank technicians for a job. Excludes off-duty / absent staff.
 *
 * @param {Object} job  work_order-shaped { work_type|required_skill, site, ... }
 * @param {{ technicians:Array, skillsByUser:Object, board:Array, assignments:Array }} ctx
 *   - technicians: [{ id|userId, full_name|name, site }]
 *   - skillsByUser: { [userId]: Array<skill_id|skill_name> }
 *   - board: buildBoard() cards [{ userId, status, name, site }]
 *   - assignments: active wo_assignments [{ user_id, active }]
 * @returns {Array<{ userId, name, score, reasons:string[], available:boolean }>}  sorted desc
 */
export function recommendTechnicians(job, ctx = {}) {
  const technicians = arr(ctx.technicians)
  const skillsByUser = ctx.skillsByUser || {}
  const board = arr(ctx.board)
  const assignments = arr(ctx.assignments)

  const boardByUser = {}
  for (const b of board) if (b && b.userId != null) boardByUser[b.userId] = b

  // Active-assignment count per technician (workload).
  const loadByUser = {}
  for (const a of assignments) {
    if (a?.active === false) continue
    const uid = a?.user_id ?? a?.userId
    if (uid == null) continue
    loadByUser[uid] = (loadByUser[uid] || 0) + 1
  }

  const reqTokens = tokenize(requiredSkillText(job))
  const hasReq = reqTokens.length > 0
  const anySkillData = Object.values(skillsByUser).some((list) => arr(list).length > 0)
  const canAssessSkill = hasReq && anySkillData
  const jobSite = job?.site || null

  const rows = []
  for (const t of technicians) {
    const userId = t.userId ?? t.id
    if (userId == null) continue
    const card = boardByUser[userId] || {}
    const status = card.status || STATUS.ABSENT
    if (EXCLUDED.has(status)) continue

    const name = t.name || t.full_name || card.name || 'Technician'
    const site = t.site || card.site || null
    const reasons = []

    // 1. Skill match.
    let skillScore
    const held = arr(skillsByUser[userId])
    if (!canAssessSkill) {
      skillScore = W_SKILL / 2 // neutral - cannot confidently assess
      reasons.push('Skill match not available')
    } else {
      const techTokens = new Set(held.flatMap(skillTokens))
      const matched = held.filter((s) => skillTokens(s).some((tok) => reqTokens.includes(tok)))
      const overlap = reqTokens.some((tok) => techTokens.has(tok))
      if (overlap && matched.length) {
        skillScore = W_SKILL
        reasons.push(`Skilled in ${skillLabel(matched[0])}`)
      } else if (held.length) {
        skillScore = 0
        reasons.push('No matching skill on record')
      } else {
        skillScore = 0
        reasons.push('No skills recorded')
      }
    }

    // 2. Availability.
    const availScore = AVAIL_SCORE[status] ?? 6
    if (status === STATUS.AVAILABLE) reasons.push('Available now')
    else if (status === STATUS.WORKING) reasons.push('Currently on a job')
    else reasons.push(`Status: ${String(status).replace(/_/g, ' ')}`)

    // 3. Workload (fewer active assignments is better).
    const load = loadByUser[userId] || 0
    const workloadScore = Math.max(0, W_WORKLOAD - load * 7)
    reasons.push(load === 0 ? 'No active jobs' : `${load} active job${load === 1 ? '' : 's'}`)

    // 4. Site match.
    let siteScore
    if (jobSite && site) {
      siteScore = jobSite === site ? W_SITE : 0
      if (siteScore) reasons.push('Same site')
    } else {
      siteScore = W_SITE / 2 // neutral when either side unknown
    }

    const score = Math.round(skillScore + availScore + workloadScore + siteScore)
    rows.push({ userId, name, score, reasons, available: status === STATUS.AVAILABLE, _load: load })
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a._load !== b._load) return a._load - b._load
    return String(a.name).localeCompare(String(b.name))
  })
  return rows.map(({ _load, ...r }) => r)
}
