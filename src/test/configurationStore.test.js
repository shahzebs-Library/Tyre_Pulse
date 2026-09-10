import { describe, it, expect, vi } from 'vitest'
import { getConfiguration, listConfiguration, saveConfiguration } from '../lib/configurationStore'

describe('tenant configuration boundary', () => {
  it('derives tenant server-side and sends all settings in one operation', async () => {
    const client={rpc:vi.fn().mockResolvedValue({data:{saved:2},error:null})}
    await saveConfiguration(client,'settings',[{key:'currency',value:'"SAR"',organisation_id:'forged'},{key:'company_name',value:'"A"'}])
    expect(client.rpc).toHaveBeenCalledWith('save_organisation_configuration',{p_namespace:'settings',p_values:[{key:'currency',value:'"SAR"'},{key:'company_name',value:'"A"'}]})
  })
  it('rejects unconfirmed and partial success without global fallback', async () => {
    const client={rpc:vi.fn().mockResolvedValue({data:{saved:0},error:null})}
    expect((await saveConfiguration(client,'settings',{key:'currency',value:'SAR'})).error).toBeTruthy()
    client.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}})
    expect((await listConfiguration(client,'settings')).error.code).toBe('PGRST202')
  })
  it('keeps empty distinct from failed reads', async () => {
    const client={rpc:vi.fn().mockResolvedValue({data:[],error:null})}
    expect((await getConfiguration(client,'app_settings','erp_connection')).data).toBeNull()
    client.rpc.mockResolvedValue({data:null,error:{code:'42501'}})
    expect((await getConfiguration(client,'app_settings','erp_connection')).error.code).toBe('42501')
  })
})
