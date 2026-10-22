import { describe,it,expect } from 'vitest'
import {
  normalizePositionConditions,normalizePhotographs,inspectablePhotoRefs,
  summarizeEvidence,validateGaugeMeasurement,measurementReading,
  buildMeasurementHistory,latestVerifiedReading,computePositionTrend,
  normalizeAiFinding,compareInspectorWithAi,inspectionReviewSummary,
  reportableFinding,reportableMeasurement,
} from './aiTyreInspectionDomain'

const inspection={ id:'inspection-1',tyre_conditions:{
  FL:{condition:'Damaged',photo:'tp-storage://inspection/FL.jpg'},
  FR:{condition:'Good',photo:'tp-storage://inspection/FR.jpg'},
  RL:{condition:'Worn',photos:['tp-storage://inspection/RL1.jpg','tp-storage://inspection/RL2.jpg']},
  RR:{condition:'Puncture'},
}}
const gauge=(values={})=>({
  inspectionId:'inspection-1',position:'FL',originalMm:16,minimumMm:2,
  innerMm:8,centerMm:9,outerMm:8.5,source:'manual_gauge',
  measuredAt:'2026-10-22T07:00:00Z',odometerKm:25000,...values,
})
describe('photo selection',()=>{
  it('returns each abnormal position photo without any fixed photo count',()=>{
    expect(inspectablePhotoRefs(inspection)).toHaveLength(3)
  })
  it('supports Flutter photo_url and explicit gauge-free screening for healthy tyres',()=>{
    const sample={id:'x',tyre_conditions:{
      FL:{condition:'Damaged',photo_url:'tp-storage://inspection/FL.jpg'},
      FR:{condition:'Good',photo_url:'tp-storage://inspection/FR.jpg'},
    }}
    expect(inspectablePhotoRefs(sample).map(p=>p.position)).toEqual(['FL'])
    expect(inspectablePhotoRefs(sample,{includeHealthy:true}).map(p=>p.position)).toEqual(['FL','FR'])
    expect(summarizeEvidence(sample).allPhotoCount).toBe(2)
    expect(summarizeEvidence(sample).defectPhotos).toBe(1)
  })
  it('excludes a good tyre from automatic AI defect analysis',()=>{
    expect(inspectablePhotoRefs(inspection).some(p=>p.position==='FR')).toBe(false)
  })
  it('preserves damaged positions with no photo as missing evidence',()=>{
    expect(summarizeEvidence(inspection).abnormalPositionsMissingPhotos).toContain('RR')
  })
  it('supports JSON serialized conditions',()=>{
    expect(normalizePositionConditions({tyre_conditions:JSON.stringify(inspection.tyre_conditions)}).FL.condition).toBe('Damaged')
  })
  it('keeps malformed conditions harmless',()=>{
    expect(normalizePositionConditions({tyre_conditions:'{'})).toEqual({})
  })
  it('supports multiple photo reference formats',()=>{
    expect(normalizePhotographs('["x","y"]')).toEqual(['x','y'])
    expect(normalizePhotographs([{ref:'a'},'b'])).toEqual(['a','b'])
  })
  it('removes exact duplicates for same position',()=>{
    const i={id:'x',tyre_conditions:{FL:{condition:'Damaged',photo:'same',photos:['same']}}}
    expect(inspectablePhotoRefs(i)).toHaveLength(1)
  })
})
describe('physical measurements',()=>{
  it('requires a physical measurement source',()=>{
    expect(validateGaugeMeasurement(gauge({source:'ai_image'})).valid).toBe(false)
  })
  it('requires depth at at least one position',()=>{
    expect(validateGaugeMeasurement(gauge({innerMm:null,centerMm:null,outerMm:null})).valid).toBe(false)
  })
  it('rejects values greater than new tread depth',()=>{
    expect(validateGaugeMeasurement(gauge({innerMm:19})).valid).toBe(false)
  })
  it('rejects negative depth',()=>{
    expect(validateGaugeMeasurement(gauge({outerMm:-1})).valid).toBe(false)
  })
  it('rejects missing inspection references',()=>{
    expect(validateGaugeMeasurement(gauge({inspectionId:''})).valid).toBe(false)
  })
  it('computes conservative remaining usable tread',()=>{
    const result=measurementReading(gauge())
    expect(result.valid).toBe(true)
    expect(result.reading.remainingMm).toBe(6)
    expect(result.reading.worstMm).toBe(8)
  })
  it('marks large depth spreads for review',()=>{
    expect(measurementReading(gauge({innerMm:5,centerMm:9,outerMm:10})).reading.unevenDepthWarning).toBe(true)
  })
  it('uses the actual measured grooves, never the model response',()=>{
    expect(measurementReading(gauge({innerMm:5, aiEstimatedMm:14})).reading.worstMm).toBe(5)
  })
  it('does not create a reading from a blank string',()=>{
    expect(measurementReading(gauge({innerMm:'',centerMm:'',outerMm:''})).valid).toBe(false)
  })
  it('retains zero as a genuine depth value',()=>{
    expect(measurementReading(gauge({innerMm:0,centerMm:1,outerMm:1})).reading.status).toBe('at_or_below_limit')
  })
})
describe('measurement timeline',()=>{
  const rows=[
    {inspection_id:'a',tyre_position:'FL',tyre_serial:'SER-1',original_mm:16,minimum_mm:2,inner_mm:10,center_mm:10,outer_mm:10,source:'manual_gauge',measured_at:'2026-08-01',odometer_km:10000},
    {inspection_id:'b',tyre_position:'FL',tyre_serial:'SER-1',original_mm:16,minimum_mm:2,inner_mm:8,center_mm:8,outer_mm:8,source:'manual_gauge',measured_at:'2026-10-01',odometer_km:20000},
  ]
  it('orders measurements by capture date',()=>{
    expect(buildMeasurementHistory(rows.slice().reverse(),'FL','SER-1')[0].inspectionId).toBe('a')
  })
  it('returns latest measured item',()=>{
    expect(latestVerifiedReading(buildMeasurementHistory(rows)).inspectionId).toBe('b')
  })
  it('uses multiple readings to generate a trend',()=>{
    expect(computePositionTrend(buildMeasurementHistory(rows)).estimatedKmToLimit).toBe(30000)
  })
  it('never forecasts using mixed tyre serials',()=>{
    expect(computePositionTrend(buildMeasurementHistory([...rows,{...rows[1],tyre_serial:'SER-2'}]))).toBeNull()
  })
  it('does not forecast without valid odometer distance',()=>{
    expect(computePositionTrend(buildMeasurementHistory(rows.map(r=>({...r,odometer_km:null}))))).toBeNull()
  })
})
describe('AI observation safeguards',()=>{
  it('rejects invented numerical tread readings',()=>{
    const value=normalizeAiFinding({assessable:true,exactTreadDepthMm:4,remainingTreadLifeKm:5000})
    expect(value.exactTreadDepthMm).toBeNull()
    expect(value.remainingTreadLifeKm).toBeNull()
  })
  it('returns unable-to-assess when photograph is insufficient',()=>{
    expect(compareInspectorWithAi('Damaged',{assessable:false,reason:'Blurry'}).status).toBe('unable_to_assess')
  })
  it('flags a contradiction against a good inspector condition',()=>{
    const finding={assessable:true,defects:[{type:'sidewall_cut',severity:'high'}]}
    expect(compareInspectorWithAi('Good',finding).status).toBe('discrepancy')
  })
  it('does not accept arbitrary model defect categories as verified',()=>{
    expect(normalizeAiFinding({assessable:true,defects:[{type:'magic',severity:'dangerous'}]}).defects[0]).toMatchObject({type:'uncertain',severity:'unknown'})
  })
  it('requires supervisor review in every model case',()=>{
    expect(normalizeAiFinding({assessable:true}).humanReviewRequired).toBe(true)
  })
  it('does not claim completion when analysis is pending',()=>{
    const summary=inspectionReviewSummary(inspection,[{inspection_id:'inspection-1',status:'pending'}],[])
    expect(summary.complete).toBe(false)
    expect(summary.pending).toBe(1)
  })
  it('does not report uncompleted findings as confirmed',()=>{
    expect(reportableFinding({status:'processing'})).toBeNull()
  })
  it('converts valid physical records into report values',()=>{
    const item=reportableMeasurement({
      inspection_id:'inspection-1',tyre_position:'FL',original_mm:16,minimum_mm:2,
      inner_mm:8,center_mm:9,outer_mm:8.5,source:'manual_gauge',measured_at:'2026-10-22',
    })
    expect(item.remainingMm).toBe(6)
  })
})
