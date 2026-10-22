import { describe,it,expect } from 'vitest'
import { buildInspectionAiAppendix,INSPECTION_AI_PRINT_STYLES } from './aiTyreInspectionReport'
const inspection={id:'a',asset_no:'MX-01',site:'West',tyre_conditions:{
  FL:{condition:'Damaged',photo:'tp-storage://p/file.jpg'},
}}
describe('inspection AI report appendix',()=>{
  it('separates pending analysis from completed findings',()=>{
    expect(buildInspectionAiAppendix({inspection,jobs:[{inspection_id:'a',status:'pending'}]})).toContain('Analysis pending')
  })
  it('describes missing AI data instead of fabricating findings',()=>{
    expect(buildInspectionAiAppendix({inspection})).toContain('No finished AI observations')
  })
  it('does not invent depth measurements',()=>{
    expect(buildInspectionAiAppendix({inspection})).toContain('No verified physical gauge measurements')
  })
  it('does not permit HTML injection from inspector fields',()=>{
    const html=buildInspectionAiAppendix({inspection:{...inspection,site:'<script>alert(1)</script>'}})
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
  it('records actual physical data as numbers',()=>{
    const measurement={inspection_id:'a',tyre_position:'FL',source:'manual_gauge',
      original_mm:16,minimum_mm:2,inner_mm:8,center_mm:9,outer_mm:8,
      measured_at:'2026-10-22T10:00:00Z'}
    const html=buildInspectionAiAppendix({inspection,measurements:[measurement]})
    expect(html).toContain('manual_gauge')
    expect(html).toContain('42.9%')
  })
  it('includes human reviewer note from completed observation',()=>{
    const jobs=[{inspection_id:'a',status:'completed',tyre_position:'FL',
      review_status:'accepted',reviewer_note:'Verify vehicle before release',
      analysis:{assessable:true,defects:[{type:'sidewall_cut',severity:'high',description:'Cut visible'}]}}]
    const html=buildInspectionAiAppendix({inspection,jobs})
    expect(html).toContain('Verify vehicle before release')
    expect(html).toContain('Cut visible')
  })
  it('clearly differentiates model evidence from physical measurement',()=>{
    expect(buildInspectionAiAppendix({inspection})).toContain('not ordinary photographs')
  })
  it('provides compatible embedded print styles',()=>{
    expect(INSPECTION_AI_PRINT_STYLES).toContain('table-layout:fixed')
  })
})
