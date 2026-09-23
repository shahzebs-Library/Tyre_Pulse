import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import WashDetailsForm from '../components/washing/WashDetailsForm'
import WashRecordViewer from '../components/washing/WashRecordViewer'
import { emptyWashDetails } from '../lib/washDetails'
vi.mock('../lib/api/washRecords',()=>({listWashCorrections:vi.fn(async()=>[])}))
vi.mock('../lib/storageRefs',()=>({resolveStorageUrl:vi.fn(async()=>null)}))

describe('wash evidence capture and viewing',()=>{
  it('records chemical details without showing a washing checklist',()=>{
    function Form(){const [value,setValue]=useState(emptyWashDetails());return <><WashDetailsForm value={value} onChange={setValue}/><output data-testid="data">{JSON.stringify(value)}</output></>}
    render(<Form/> )
    fireEvent.change(screen.getByLabelText('Chemical use'),{target:{value:'used'}})
    fireEvent.change(screen.getByLabelText('Product name'),{target:{value:'Recorded product'}})
    const value=JSON.parse(screen.getByTestId('data').textContent)
    expect(value.chemicals[0].name).toBe('Recorded product')
    // The key is carried for the server CHECK but no screen captures items, so
    // it stays empty.
    expect(value.checklist).toEqual([])
    expect(screen.queryByText('Wash checklist')).not.toBeInTheDocument()
  })
  it('opens recorded answers, creator and chemicals as a reading surface',async()=>{
    const close=vi.fn()
    render(<WashRecordViewer onClose={close} row={{id:'w1',asset_no:'TEST',entry_name:'Entry Person',created_by:'user1',washed_by:'Wash Operator',wash_details:{chemical_status:'used',chemicals:[{name:'Recorded product'}],checklist:[{label:'Cab interior',result:'fail',note:'Seat needs another clean'}]}}}/> )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Entry Person')).toBeInTheDocument()
    expect(screen.getByText('Wash Operator')).toBeInTheDocument()
    expect(screen.getByText('Recorded product')).toBeInTheDocument()
    expect(screen.queryByText('Wash checklist')).not.toBeInTheDocument()
    expect(screen.queryByText('Seat needs another clean')).not.toBeInTheDocument()
    await waitFor(()=>expect(screen.getByText('No corrections recorded.')).toBeInTheDocument())
    fireEvent.keyDown(document,{key:'Escape'})
    expect(close).toHaveBeenCalled()
  })
})
