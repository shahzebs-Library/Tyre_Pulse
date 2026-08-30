import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Action Center loading state', () => {
  it('normalises the nullable request state before filtering derived rows', () => {
    const source = readFileSync('src/pages/ActionCenter.jsx', 'utf8').replace(/\r\n/g, '\n')
    expect(source).toContain('const [rows, setRows] = useState(null)')
    expect(source).toContain('const allRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])')
    expect(source).not.toContain('const allRows = rows\n')
  })
})
