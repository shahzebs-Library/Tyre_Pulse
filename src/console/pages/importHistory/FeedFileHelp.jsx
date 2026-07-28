import { useMemo, useState } from 'react'
import { FileSpreadsheet, Copy, Check, AlertTriangle, Info } from 'lucide-react'
import { Note, Badge, Btn, Code } from '../../components/ui'
import { howToFill, reimportWarning } from '../../../lib/coverageSources'

/**
 * What to upload to close this gap.
 *
 * The coverage panel already says "KSA job cards missed 23 days". On its own
 * that is half an answer - the reader still has to work out which export it is,
 * which table it goes into and what the headers must say. All of that is already
 * recorded in IMPORT_TARGETS; this puts it next to the gap it explains.
 *
 * @param {{src:string, country?:string}} props
 */
export default function FeedFileHelp({ src, country }) {
  const [copied, setCopied] = useState('')
  const help = useMemo(() => howToFill(src, country), [src, country])

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      // Clipboard can be refused; the headers are on screen either way, so this
      // is a convenience failing, not the feature failing.
      setCopied('')
    }
  }

  if (!help.available) {
    return (
      <Note icon={Info}>
        {help.reason}
      </Note>
    )
  }

  const warn = reimportWarning(help.reimportSafe)

  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex items-start gap-2">
        <FileSpreadsheet size={13} className="text-orange-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-gray-300">
            Upload the <span className="text-gray-100">{help.sourceFile}</span>
          </p>
          <p className="text-gray-500 mt-0.5">
            {help.intoTable ? (
              <>
                into <Code>{help.intoTable}</Code>
                {/* The country comes from the table name on these, which is the
                    whole point of the per-country tables - it cannot be forgotten. */}
                {!help.needsCountry && ' - the country comes from the table name, so there is no country column to fill'}
              </>
            ) : (
              <>
                into one of <Code>{help.allTables.join(', ')}</Code>
                {country ? ` (no table for ${country})` : ''}
              </>
            )}
          </p>
          <p className="text-gray-600 mt-0.5">It becomes rows in <Code>{help.feeds}</Code>.</p>
        </div>
      </div>

      {help.needsCountry && (
        <Note icon={AlertTriangle} tone="warning">
          This one still needs a country column in the file itself.
        </Note>
      )}

      <Note icon={AlertTriangle} tone={warn.tone === 'danger' ? 'danger' : warn.tone === 'good' ? 'default' : 'warning'}>
        {warn.text}
      </Note>

      {help.columns.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-gray-400">
              The file must have these {help.columns.length} headers
            </span>
            {help.verbatimHeaders && (
              /* Not a style note. The importer matches the header text literally,
                 so "correcting" a misspelling in the file breaks the import. */
              <Badge tone="warning">exactly as written, including any misspelling</Badge>
            )}
            <Btn
              size="xs"
              icon={copied === 'cols' ? Check : Copy}
              onClick={() => copy(help.columns.join('\t'), 'cols')}
            >
              {copied === 'cols' ? 'Copied' : 'Copy header row'}
            </Btn>
          </div>
          <div className="flex flex-wrap gap-1">
            {help.columns.map((c) => (
              <span key={c}
                className="px-1.5 py-0.5 rounded border border-gray-800 bg-gray-900 text-gray-400 font-mono text-[10px]">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {help.notes && (
        <details className="text-gray-500">
          <summary className="cursor-pointer hover:text-gray-300">What else to watch for</summary>
          <p className="mt-1 leading-relaxed text-gray-400">{help.notes}</p>
        </details>
      )}
    </div>
  )
}
