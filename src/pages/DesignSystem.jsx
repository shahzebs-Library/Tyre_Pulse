import { useState } from 'react'
import {
  AlertTriangle, Check, Info, Layers, Palette, Rows, Table2, Type,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader, CardBody, CardFooter, CardGrid } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'

/**
 * DESIGN SYSTEM — the one page that shows the kit as it actually renders.
 *
 * WHY THIS EXISTS RATHER THAN STORYBOOK. The goal is to stop the UI drifting,
 * and the measured cause of drift here was never a missing component — it was
 * that the kit existed and nobody could see it, so each page hand-rolled its
 * own card, overlay and table. A gallery inside the app, on the app's own
 * tokens, fixes discoverability at a fraction of the weight: Storybook would
 * add a second build, a second dependency tree and a second theming path that
 * can itself drift from production.
 *
 * It is also the honest place to record the traps. Every one below is a real
 * defect that shipped in this repo and was caught later, so each is written
 * next to the thing that causes it rather than in a document nobody opens.
 *
 * Because it renders the REAL components against the REAL tokens, switching the
 * app between light and dark, or changing a token, is visible here immediately.
 */

const SPACE = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12']
const TYPE = [
  ['--fs-xs', 'Extra small · table meta, captions'],
  ['--fs-sm', 'Small · secondary text'],
  ['--fs-body', 'Body · the default'],
  ['--fs-md', 'Medium · card titles'],
  ['--fs-lg', 'Large · section titles'],
  ['--fs-xl', 'Extra large · page titles'],
]
const TONES = [
  ['default', 'Neutral. The default; carries no meaning.'],
  ['info', 'Informational. Context, not a problem.'],
  ['good', 'Healthy / within target.'],
  ['warn', 'Needs attention soon.'],
  ['crit', 'Act now.'],
]

const DEMO_ROWS = [
  { id: '1', asset: 'TM514', site: 'NHC', status: 'Active', cpk: 0.42 },
  { id: '2', asset: 'MP083', site: 'JED', status: 'Removed', cpk: null },
  { id: '3', asset: 'BH021', site: 'DHAHBAN', status: 'Active', cpk: 0.77 },
]
const DEMO_COLUMNS = [
  { accessorKey: 'asset', header: 'Asset' },
  { accessorKey: 'site', header: 'Site', meta: { filterVariant: 'select' } },
  { accessorKey: 'status', header: 'Status' },
  {
    accessorKey: 'cpk',
    header: 'CPK',
    meta: { align: 'right' },
    // The null-vs-zero rule, demonstrated rather than described: an
    // unmeasurable rate is N/A. A fabricated 0 reads as "perfect".
    cell: ({ getValue }) => (getValue() == null ? <span className="text-dim">N/A</span> : getValue().toFixed(2)),
  },
]

function Trap({ children }) {
  return (
    <div
      className="flex gap-2 text-xs"
      style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}
    >
      <AlertTriangle size={14} className="flex-shrink-0 mt-px" style={{ color: 'var(--warn, #f5a524)' }} />
      <p className="min-w-0">{children}</p>
    </div>
  )
}

function Swatch({ token, label }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="inline-block w-8 h-8 rounded-lg flex-shrink-0"
        style={{ background: `var(${token})`, border: '1px solid var(--border-dim)' }}
      />
      <span className="min-w-0">
        <code className="block truncate">{token}</code>
        <span className="text-dim">{label}</span>
      </span>
    </div>
  )
}

export default function DesignSystem() {
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="space-y-[var(--gap-section)]">
      <PageHeader
        title="Design system"
        subtitle="The shared kit, rendered on the app's own tokens. Build new screens from these."
        icon={Layers}
      />

      <Card tone="info">
        <div style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-3)' }}>
          <Info size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
          <div className="min-w-0 text-sm">
            <p className="font-medium">Use these instead of hand-rolling.</p>
            <p className="text-dim mt-1">
              A measured audit found the kit was present but barely adopted: 194 pages hand-rolled a
              table and 130 hand-rolled an overlay, each re-implementing focus trapping, escape to
              close and scroll locking, and most skipping at least one.
              <code className="mx-1">src/test/designSystemRatchet.test.js</code>
              now fails the build if a new page adds to that debt.
            </p>
          </div>
        </div>
      </Card>

      {/* ── Cards ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Card" description="The surface. Replaces the legacy .card class." icon={Layers} level={2} />
        <CardBody>
          <CardGrid min="240px">
            {TONES.map(([tone, meaning]) => (
              <Card key={tone} tone={tone} pad="tight">
                <p className="text-sm font-medium">tone=&quot;{tone}&quot;</p>
                <p className="text-xs text-dim mt-1">{meaning}</p>
              </Card>
            ))}
          </CardGrid>

          <Trap>
            <strong>Card sets padding, border, borderColor and background INLINE.</strong> A plain
            Tailwind class is a normal declaration and loses to an inline one, so
            <code className="mx-1">{'<Card className="py-12 border bg-amber-900/10">'}</code>
            is entirely dead — and it fails silently, collapsing to <code>--pad-card</code> with no
            tint. Put spacing on an inner element and use <code>tone</code> for the tint. Never
            reach for <code>!important</code> on a layout utility.
          </Trap>
          <Trap>
            <strong>Card is <code>flex flex-col</code>, and Tailwind emits <code>.flex-col</code> after
            <code className="mx-1">.flex-row</code></strong> — so a <code>flex-row</code> class can never win.
            Row direction needs <code>{'style={{ flexDirection: \'row\' }}'}</code>.
          </Trap>
          <Trap>
            <strong>Pass <code>clip</code> only for media that must crop to the radius.</strong> The
            hazard is DOM-rendered overlays inside the card (anchored popovers, a search result
            list, a custom date picker). A native <code>&lt;select&gt;</code> is safe — the browser
            paints its option list outside the page&apos;s overflow context entirely.
          </Trap>
          <Trap>
            <strong><code>CardHeader</code>&apos;s <code>actions</code> slot is <code>flex-shrink-0</code>
            and cannot wrap.</strong> Right for one or two controls, wrong for a row of filter
            buttons: an inner <code>flex-wrap</code> inside a non-shrinking box has nothing to wrap
            against, so a phone-width card pushes the page into horizontal scroll — invisible at
            desktop width.
          </Trap>
        </CardBody>
        <CardFooter>
          <span className="text-xs text-dim">
            pad: default · tight · none &nbsp;|&nbsp; also: interactive, accent, clip, as
          </span>
        </CardFooter>
      </Card>

      {/* ── Tokens ───────────────────────────────────────────────────────── */}
      <CardGrid min="320px">
        <Card>
          <CardHeader title="Spacing" description="4pt rhythm. One attribute retightens every kit component." icon={Rows} level={2} />
          <CardBody>
            <div className="space-y-1.5">
              {SPACE.map((n) => (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <code className="w-24 flex-shrink-0">--space-{n}</code>
                  <span className="h-3 rounded" style={{ width: `var(--space-${n})`, background: 'var(--accent)', minWidth: 1 }} />
                </div>
              ))}
            </div>
            <Trap>
              Density is a single attribute on <code>&lt;html&gt;</code>:
              <code className="mx-1">data-density=&quot;compact&quot;</code> re-points
              <code className="mx-1">--pad-card</code> and the gaps, so every kit component
              retightens at once. Do not hand-tune padding per page to get a denser table.
            </Trap>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Type scale" description="Sizes are tokens, never literals." icon={Type} level={2} />
          <CardBody>
            <div className="space-y-2">
              {TYPE.map(([token, label]) => (
                <div key={token} className="flex items-baseline gap-3 min-w-0">
                  <span style={{ fontSize: `var(${token})`, lineHeight: 'var(--lh-tight)' }}>Aa</span>
                  <span className="min-w-0">
                    <code className="text-xs">{token}</code>
                    <span className="block text-xs text-dim truncate">{label}</span>
                  </span>
                </div>
              ))}
            </div>
            <Trap>
              Money and any column of figures use <code>--num-tabular</code>, or the digits shift
              width between rows and the column stops scanning as a column.
            </Trap>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Surfaces & text" description="Both themes resolve from these." icon={Palette} level={2} />
          <CardBody>
            <div className="grid grid-cols-2 gap-2">
              <Swatch token="--bg-base" label="page" />
              <Swatch token="--surface-1" label="card" />
              <Swatch token="--surface-2" label="raised" />
              <Swatch token="--accent" label="brand / action" />
              <Swatch token="--border-dim" label="hairline" />
              <Swatch token="--border-brand" label="card border" />
            </div>
            <Trap>
              <code>--accent</code> follows the tenant&apos;s brand colour, and a personal accent set
              in Settings outranks the org&apos;s. Never hard-code a brand hex; a white-labelled
              customer would keep seeing ours.
            </Trap>
          </CardBody>
        </Card>
      </CardGrid>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Modal" description="Focus trap, escape to close, scroll lock, focus return." level={2} />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => setModalOpen(true)}>
              Open a form dialog
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setConfirmOpen(true)}>
              Open a confirm dialog
            </button>
          </div>
          <Trap>
            Keep a submit button <strong>inside</strong> its <code>&lt;form&gt;</code>. Moving it to
            the <code>footer</code> slot needs a <code>form=&quot;id&quot;</code> association, which
            is a behaviour change, not a styling one. Use <code>footer</code> for dialogs with no form.
          </Trap>
          <Trap>
            Modal portals to <code>document.body</code>, which is what stops the legacy
            <code className="mx-1">.card</code> <code>overflow:hidden</code> clipping it. Do not
            wrap one in a positioned ancestor to &quot;fix&quot; placement.
          </Trap>
        </CardBody>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Form dialog" size="md">
        <form
          onSubmit={(e) => { e.preventDefault(); setModalOpen(false) }}
          className="space-y-[var(--space-4)]"
        >
          <label className="block">
            <span className="block text-xs text-dim mb-1">A field</span>
            <input className="input w-full" placeholder="Type here — focus must not jump" />
          </label>
          <p className="text-xs text-dim">
            Typing here is the regression test for <code>useDialogBehavior</code>: focus used to be
            ripped out on every keystroke for any dialog whose form state lives in the page.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary text-sm">Save</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete this record?"
        size="sm"
        footer={
          <>
            <button type="button" className="btn-ghost text-sm" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button type="button" className="btn-danger text-sm" onClick={() => setConfirmOpen(false)}>Delete</button>
          </>
        }
      >
        <p className="text-sm text-dim">
          A destructive action names what it will remove and cannot be the default focus — the panel
          is focused, not its first control, so Enter never deletes by accident.
        </p>
      </Modal>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <Card pad="none">
        <div style={{ padding: 'var(--pad-card)', paddingBottom: 0 }}>
          <CardHeader
            title="EnterpriseTable"
            description="Search, filters, multi-sort, selection, export — and with a viewKey: pin, resize, density and a keyboard path."
            icon={Table2}
            level={2}
          />
        </div>
        <EnterpriseTable
          columns={DEMO_COLUMNS}
          data={DEMO_ROWS}
          getRowId={(r) => r.id}
          viewKey="design-system-demo"
          enableExport={false}
          searchPlaceholder="Press / to search…"
        />
        <div style={{ padding: 'var(--pad-card)', paddingTop: 0 }}>
          <Trap>
            <strong>Do not convert a table that already owns its pagination and export.</strong> All
            19 examined during the migration were correctly refused — EnterpriseTable would have
            added a second search box and a competing export beside the ones already there.
          </Trap>
          <Trap>
            <code>viewKey</code> is opt-in. Without it the table behaves exactly as before, which is
            deliberate: it is shared by many pages and a change in default behaviour would land on
            all of them at once.
          </Trap>
        </div>
      </Card>

      {/* ── Honesty ──────────────────────────────────────────────────────── */}
      <Card tone="warn">
        <CardHeader title="Honest states" description="The rule that outranks every styling rule here." level={2} icon={AlertTriangle} />
        <CardBody>
          <CardGrid min="230px">
            <Card pad="tight">
              <p className="text-xs font-medium">Not measurable</p>
              <p className="text-lg" style={{ fontVariantNumeric: 'tabular-nums' }}>N/A</p>
              <p className="text-xs text-dim mt-1">
                A rate with no denominator. Never render 0 — zero reads as perfect.
              </p>
            </Card>
            <Card pad="tight">
              <p className="text-xs font-medium">Nothing recorded</p>
              <p className="text-lg text-dim">Not recorded</p>
              <p className="text-xs text-dim mt-1">
                Different from zero. &quot;Nobody told us&quot; is not &quot;it never happened&quot;.
              </p>
            </Card>
            <Card pad="tight">
              <p className="text-xs font-medium">Could not look</p>
              <p className="text-lg text-dim">Unavailable</p>
              <p className="text-xs text-dim mt-1">
                A failed read is not an empty result. Say so, and offer Retry.
              </p>
            </Card>
            <Card pad="tight" tone="good">
              <p className="text-xs font-medium">Genuinely empty</p>
              <p className="text-lg"><Check size={18} className="inline" /> None</p>
              <p className="text-xs text-dim mt-1">
                We looked, and there is nothing. Only this one may read as good news.
              </p>
            </Card>
          </CardGrid>
          <Trap>
            These four look alike on screen and mean opposite things. Collapsing them is the most
            common defect in this codebase&apos;s history — a fabricated zero has previously made a
            fleet look perfectly compliant when nothing had been measured at all.
          </Trap>
        </CardBody>
      </Card>
    </div>
  )
}
