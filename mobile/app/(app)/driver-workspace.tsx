import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, TextInput, ScrollView, Modal, Switch, Image, Linking, BackHandler } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Screen, Card, AppText as BaseAppText, Button as BaseButton, ListRow } from '../../components/ui'
import { withModuleGuard } from '../../components/ModuleGuard'
import SignaturePad from '../../components/SignaturePad'
import SignatureView from '../../components/SignatureView'
import { toUserMessage as safeUserMessage } from '../../lib/safeError'
import { backTo } from '../../lib/goBack'
import { WorkspaceData, RESOLUTIONS, RECORD_TYPES, RECEIPT_STATEMENT, recordLabel, validateFineResponse, workspaceRequestId, loadDriverWorkspace, driverWorkspaceCommand, driverWorkspaceOptions, fineSignature, evidenceUrl, uploadFinePhoto, readWorkspaceSaved, saveWorkspaceData, clearWorkspaceData } from '../../lib/driverWorkspace'
import { driverCopy } from '../../lib/driverWorkspaceCopy'

function AppText(props: React.ComponentProps<typeof BaseAppText>) {
  const { language } = useLanguage()
  return <BaseAppText {...props}>{React.Children.map(props.children, child => typeof child === 'string' ? driverCopy(child, language) : child)}</BaseAppText>
}
function Button(props: React.ComponentProps<typeof BaseButton>) {
  const { language } = useLanguage()
  return <BaseButton {...props} label={driverCopy(props.label, language)} />
}

const names: Record<string,string> = { direct_payment: 'I will pay directly', already_paid: 'Already paid', dispute: 'Dispute / incorrect assignment', company_recovery: 'Request company payment / recovery', instalments: 'Request instalments', create_driver: 'Add verified driver', link_account: 'Link login account', assign_team: 'Assign team and vehicle', create_fine: 'Issue traffic fine', link_record: 'Link work record', respond_fine: 'Review and sign', review_fine: 'Review response / payment' }
const human = (key: string) => names[key] || key.replace(/_/g, ' ')
const toUserMessage = (error: unknown, fallback: string) => safeUserMessage(error as Parameters<typeof safeUserMessage>[0], fallback)
const fields: Record<string,string[][]> = {
  create_driver: [['driver_id','Employee ID'],['driver_name','Driver name'],['country','Country'],['site','Site']],
  link_account: [['user_id','Login account (none removes link)','users'],['reason','Identity verification / reason']],
  assign_team: [['supervisor_id','Supervisor','users'],['manager_id','Manager','users'],['vehicle_id','Vehicle','vehicles'],['reason','Assignment reason']],
  create_fine: [['vehicle_id','Vehicle','vehicles'],['authority','Issuing authority'],['notice_reference','Notice reference'],['incident_at','Incident date and time (YYYY-MM-DDTHH:mm)'],['due_date','Due date (YYYY-MM-DD)'],['amount','Fine amount','number'],['currency','Currency code'],['description','Notice details'],['assignment_reason','Evidence confirming driver assignment']],
  link_record: [['source_type','Record type','record_type'],['source_id','Existing record','records'],['reason','How driver identity was verified']],
  respond_fine: [['resolution','Preferred resolution','resolution'],['explanation','Explanation / proposed arrangement'],['payment_reference','Payment reference (if paid)'],['proposed_date','Proposed payment date (YYYY-MM-DD)']],
  review_fine: [['decision','Decision','decision'],['reason','Review reason / approved arrangement'],['payment_reference','Verified payment reference'],['payment_amount','Verified payment amount','number']],
}

function Input({ label, value, onChange, numeric = false }: { label: string; value: any; onChange: (v:string)=>void; numeric?:boolean }) {
  const { theme } = useTheme(); const { isRTL } = useLanguage()
  return <View style={{ gap: 6 }}><AppText>{label}</AppText><TextInput accessibilityLabel={label} value={value == null ? '' : String(value)} onChangeText={onChange} keyboardType={numeric ? 'decimal-pad' : 'default'} maxLength={4000} style={{ color: theme.color.text, backgroundColor: theme.color.surface, borderColor: theme.color.borderStrong, borderWidth: 1, borderRadius: 10, padding: 12, textAlign: isRTL ? 'right' : 'left' }} /></View>
}

function Picker({ label, kind, value, onChange }: { label:string; kind:string; value:any; onChange:(v:any)=>void }) {
  const [query,setQuery] = useState(''); const [rows,setRows] = useState<WorkspaceData[]>([]); const [error,setError] = useState(''); const [offset,setOffset] = useState(0); const [open,setOpen] = useState(false)
  useEffect(()=>{ if (!open) return; let live=true; const timer=setTimeout(()=>driverWorkspaceOptions(kind,query,offset).then(r=>{if(live){setRows(r);setError('')}}).catch(e=>{if(live)setError(toUserMessage(e,'Options unavailable'))}),200); return ()=>{live=false;clearTimeout(timer)} },[kind,query,offset,open])
  return <View style={{ gap: 8 }}><Button variant="secondary" label={`${label}${value ? ' ✓' : ''}`} onPress={()=>setOpen(!open)} />{open && <><Input label={`Search ${label}`} value={query} onChange={q=>{setQuery(q);setOffset(0)}} /><Button variant="ghost" label="None / clear selection" onPress={()=>{onChange(null);setOpen(false)}} />{rows.slice(0,100).map(r=><ListRow key={r.id} title={r.label || recordLabel(r.record)} onPress={()=>{onChange(r.id);setOpen(false)}} />)}{offset>0 && <Button label="Previous options" onPress={()=>setOffset(offset-100)} />}{rows.length>100 && <Button label="More options" onPress={()=>setOffset(offset+100)} />}{error ? <AppText>{error}</AppText> : null}</>}</View>
}

function ActionForm({ action, driverId, fine, owner, onClose, onSaved }: {action:string;driverId:string|null;fine?:WorkspaceData;owner:string;onClose:()=>void;onSaved:()=>void}) {
  const { language } = useLanguage()
  const [values,setValues] = useState<WorkspaceData>({source_type:RECORD_TYPES[0],resolution:'direct_payment',decision:'approve'}); const [error,setError]=useState(''); const [saving,setSaving]=useState(false); const [ready,setReady]=useState(action!=='respond_fine'); const [saved,setSaved]=useState(false)
  const request=useRef(workspaceRequestId()); const draftKey=`draft_${fine?.id || 'new'}`
  useEffect(()=>{ if(action!=='respond_fine')return; let live=true; readWorkspaceSaved(owner,draftKey).then(d=>{if(!live)return;if(d){setValues({...d.values,acknowledged:false,...(d.version!==fine?.version?{signature:null}:{})});request.current=d.requestId || workspaceRequestId()}setReady(true)}).catch(e=>{if(live)setError(toUserMessage(e,'Saved draft unavailable'))});return()=>{live=false} },[owner,draftKey,action,fine?.version])
  const set=(key:string,value:any)=>{setSaved(false);request.current=workspaceRequestId();setValues(v=>({...v,[key]:value,...(key==='source_type'?{source_id:null}:{})}))}
  async function saveDraft(){try{await saveWorkspaceData(owner,draftKey,{values,version:fine?.version,requestId:request.current});setSaved(true);setError('')}catch(e){setError(toUserMessage(e,'Draft could not be saved'))}}
  async function submit(){if(saving||!ready)return;const issue=action==='respond_fine'?validateFineResponse(values):null;if(issue){setError(issue);return}setSaving(true);setError('');try{
    const payload:WorkspaceData={...values,driver_id:action==='create_driver'?values.driver_id:driverId,...(fine?{fine_id:fine.id,version:fine.version}:{})};
    if(action==='respond_fine'){payload.statement_version='receipt-v1';payload.statement_language=language;await saveWorkspaceData(owner,draftKey,{values,version:fine?.version,requestId:request.current})}
    if(payload.incident_at)payload.incident_at=new Date(payload.incident_at).toISOString()
    for(const key of ['due_date','proposed_date','user_id','supervisor_id','manager_id','vehicle_id'])if(payload[key]==='')payload[key]=null
    await driverWorkspaceCommand(action,payload,request.current)
    if(action==='respond_fine')await clearWorkspaceData(owner,draftKey)
    onSaved()
  }catch(e){setError(toUserMessage(e,'Could not submit. Refresh if the notice changed.'))}finally{setSaving(false)}}
  return <Modal visible animationType="slide" onRequestClose={onClose}><Screen><ScrollView contentContainerStyle={{padding:16,gap:14}} keyboardShouldPersistTaps="handled"><AppText variant="title">{human(action)}</AppText><AppText>Submission requires a connection so the current notice and your access can be checked.</AppText>
    {ready && fields[action].map(([key,label,type])=><View key={key} style={{gap:8}}>{['users','vehicles','records'].includes(type)?<Picker label={label} kind={type==='records'?values.source_type:type} value={values[key]} onChange={v=>set(key,v)} />:['resolution','decision','record_type'].includes(type)?<><AppText>{label}</AppText>{(type==='resolution'?RESOLUTIONS:type==='record_type'?RECORD_TYPES:['approve','return','payment','cancel','reopen']).map(option=><Button key={option} variant={values[key]===option?'primary':'secondary'} label={human(option)} onPress={()=>set(key,option)} />)}</>:<Input label={label} value={values[key]} numeric={type==='number'} onChange={v=>set(key,v)} />}</View>)}
    {ready && action==='respond_fine' && <><AppText>{RECEIPT_STATEMENT}</AppText><Switch accessibilityLabel="Acknowledge receipt" value={!!values.acknowledged} onValueChange={v=>set('acknowledged',v)} /><SignaturePad value={values.signature} onChange={v=>set('signature',v)} /><Button variant="secondary" label="Save draft on this device" onPress={saveDraft} />{saved && <AppText>Draft saved. It has not been submitted.</AppText>}</>}
    {action==='review_fine' && <AppText>Approval records the reviewed arrangement. It does not execute payment or payroll deduction. Record only verified payments.</AppText>}
    {error ? <AppText>{error}</AppText> : null}<Button label="Submit" disabled={!ready} loading={saving} onPress={submit} /><Button label="Back" variant="secondary" disabled={saving} onPress={onClose} />
  </ScrollView></Screen></Modal>
}

function FineCard({fine,data,onAction,refresh}:{fine:WorkspaceData;data:WorkspaceData;onAction:(name:string,fine:WorkspaceData)=>void;refresh:()=>void}){
 const [open,setOpen]=useState(false);const [signature,setSignature]=useState<string|null>(null);const [error,setError]=useState('');const [uploading,setUploading]=useState(false)
 async function photo(kind:string){setUploading(true);setError('');try{const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:0.8});if(!result.canceled){await uploadFinePhoto(fine,result.assets[0].uri,kind,workspaceRequestId());refresh()}}catch(e){setError(toUserMessage(e,'Photo could not be attached'))}finally{setUploading(false)}}
 return <Card><View style={{gap:12}}><ListRow title={`${fine.notice_reference} · ${fine.amount} ${fine.currency}`} subtitle={`${human(fine.status)} · ${human(fine.response_status)}`} onPress={()=>setOpen(!open)} />{open && <><AppText>{fine.authority} · {fine.asset_no}</AppText><AppText>{new Date(fine.incident_at).toLocaleString()}</AppText><AppText>{fine.description}</AppText><AppText>Assignment: {fine.assignment_reason}</AppText><AppText>Due: {fine.due_date || 'Not supplied'} · Paid: {fine.paid_amount} · Balance: {Number(fine.amount)-Number(fine.paid_amount)} {fine.currency}</AppText>
  {data.can_respond && fine.status==='open' && ['awaiting_response','returned'].includes(fine.response_status) && <Button label="Acknowledge and respond" onPress={()=>onAction('respond_fine',fine)} />}{data.can_review && <Button label="Review / record payment" variant="secondary" onPress={()=>onAction('review_fine',fine)} />}
  {(fine.evidence||[]).map((e:WorkspaceData)=><Button key={e.id} variant="secondary" label={`${human(e.kind)}: ${e.file_name}`} onPress={async()=>{try{await Linking.openURL(await evidenceUrl(e.object_path))}catch(err){setError(toUserMessage(err,'Evidence unavailable'))}}} />)}
  {(data.can_respond||data.can_review) && fine.status==='open' && <><Button label="Attach receipt photo" variant="secondary" loading={uploading} onPress={()=>photo('payment')} /><Button label="Attach supporting photo" variant="secondary" disabled={uploading} onPress={()=>photo('supporting')} />{data.can_review && ['awaiting_response','returned'].includes(fine.response_status) && <Button label="Attach official notice photo" disabled={uploading} variant="secondary" onPress={()=>photo('notice')} />}</>}
  {(fine.responses||[]).map((r:WorkspaceData)=><View key={r.id} style={{gap:8}}><AppText>{human(r.resolution)} · {new Date(r.signed_at).toLocaleString()}</AppText><AppText>{r.explanation}</AppText>{r.payment_reference && <AppText>{r.payment_reference}</AppText>}<Button label="View signed acknowledgment" variant="secondary" onPress={async()=>{try{setSignature(await fineSignature(r.id))}catch(e){setError(toUserMessage(e,'Signature unavailable'))}}} /></View>)}
  {signature && <><AppText>{RECEIPT_STATEMENT}</AppText>{signature.startsWith('<svg')?<SignatureView value={signature} />:<Image source={{uri:signature}} resizeMode="contain" style={{height:160,backgroundColor:'white'}} />}</>}{error ? <AppText>{error}</AppText> : null}
 </>}</View></Card>
}

function DriverWorkspaceScreen(){
 const {user,profile}=useAuth();const {isRTL}=useLanguage();const router=useRouter();const owner=`${user?.id || ''}_${(profile as any)?.org_id || (profile as any)?.organisation_id || ''}`
 const [driverId,setDriverId]=useState<string|null>(null);const [data,setData]=useState<WorkspaceData|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [action,setAction]=useState<{name:string;fine?:WorkspaceData}|null>(null);const [query,setQuery]=useState('');const sequence=useRef(0)
 const load=useCallback(async()=>{const seq=++sequence.current;setLoading(true);setError('');setData(null);const key=`cache_${driverId||'roster'}`;try{const result=await loadDriverWorkspace(driverId);if(seq!==sequence.current)return;setData(result);await saveWorkspaceData(owner,key,{saved_at:Date.now(),data:result})}catch(e:any){if(seq!==sequence.current)return;setError(toUserMessage(e,'Workspace unavailable'));if(/network|fetch|offline/i.test(String(e?.message))&&!e?.code){try{const cached=await readWorkspaceSaved(owner,key);if(cached&&Date.now()-cached.saved_at<86400000&&seq===sequence.current)setData({...cached.data,offline:true,can_manage:false,can_review:false,can_respond:false})}catch(err){setError(toUserMessage(err,'Saved workspace unavailable'))}}}finally{if(seq===sequence.current)setLoading(false)}},[driverId,owner])
 useEffect(()=>{load();return()=>{sequence.current++}},[load]);useEffect(()=>{setAction(null);setDriverId(null)},[owner])
 useEffect(()=>{if(!driverId)return;const sub=BackHandler.addEventListener('hardwareBackPress',()=>{setDriverId(null);return true});return()=>sub.remove()},[driverId])
 async function exportReport(){if(!data?.driver||data.truncated)return;try{const escape=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));const html=`<html dir="${isRTL?'rtl':'ltr'}"><meta charset="utf-8"><body><h1>${escape(data.driver.driver_name)}</h1><p>${escape(data.driver.driver_id)}</p><table><tr><th>Notice</th><th>Amount</th><th>Paid</th><th>Status</th><th>Response</th></tr>${data.fines.map((f:WorkspaceData)=>`<tr><td>${escape(f.notice_reference)}</td><td>${escape(f.amount)} ${escape(f.currency)}</td><td>${escape(f.paid_amount)}</td><td>${escape(f.status)}</td><td>${escape(f.response_status)}</td></tr>`).join('')}</table></body></html>`;const file=await Print.printToFileAsync({html});await Sharing.shareAsync(file.uri,{mimeType:'application/pdf'})}catch(e){setError(toUserMessage(e,'Report could not be shared'))}}
 return <Screen><ScrollView contentContainerStyle={{padding:16,gap:14}} keyboardShouldPersistTaps="handled"><AppText variant="title">Driver workspace</AppText><AppText>Fines, verified work records, supervisors and vehicle assignments</AppText><Button label="Back" variant="secondary" onPress={()=>driverId?setDriverId(null):backTo(router,'/(app)')} /><Button label="Refresh" variant="secondary" loading={loading} onPress={load} />{error ? <AppText>{error}</AppText> : null}{data?.offline && <AppText>Offline cached view. Connect and refresh before responding or reviewing.</AppText>}{data?.truncated && <AppText>This view is incomplete because it reached the record limit. Export is disabled.</AppText>}
  {data&&!driverId&&<>{data.can_manage&&<Button label="Add verified driver" onPress={()=>setAction({name:'create_driver'})} />}<Input label="Search drivers" value={query} onChange={setQuery} />{data.drivers.length===0&&<AppText>No linked driver or assigned team is available. Ask an authorized manager to verify your account and assignment.</AppText>}{data.drivers.filter((d:WorkspaceData)=>`${d.driver_name} ${d.driver_id} ${d.site}`.toLowerCase().includes(query.toLowerCase())).map((d:WorkspaceData)=><ListRow key={d.id} title={`${d.driver_name} · ${d.driver_id}`} subtitle={`${d.position ? d.position + ' · ' : ''}${d.site} · ${d.open_fines} open fines · ${d.awaiting_response} awaiting response`} onPress={()=>setDriverId(d.id)} />)}</>}
  {data?.driver&&<><AppText variant="title">{data.driver.driver_name} · {data.driver.driver_id}</AppText><AppText>{data.driver.position || 'Position not recorded'}</AppText><AppText>{data.driver.country} · {data.driver.site}</AppText>{data.can_manage&&['link_account','assign_team','link_record'].map(name=><Button key={name} label={human(name)} variant="secondary" onPress={()=>setAction({name})} />)}{data.can_review&&<Button label="Issue traffic fine" onPress={()=>setAction({name:'create_fine'})} />}<Button label="Share fine statement PDF" variant="secondary" disabled={data.truncated} onPress={exportReport} />{data.balances.map((b:WorkspaceData)=><AppText key={b.currency}>Outstanding: {b.outstanding} {b.currency}</AppText>)}<AppText variant="title">Traffic fines</AppText>{!data.fines.length&&<AppText>No fines recorded.</AppText>}{data.fines.map((f:WorkspaceData)=><FineCard key={`${f.id}-${f.version}`} fine={f} data={data} onAction={(name,fine)=>setAction({name,fine})} refresh={load} />)}
   <AppText variant="title">Team and vehicle assignment history</AppText>{!data.assignments.length&&<AppText>No assignment recorded.</AppText>}{data.assignments.map((a:WorkspaceData)=><Card key={a.id}><AppText>{a.ends_at?'Previous':'Current'} · {a.asset_no||'No vehicle'}</AppText><AppText>Supervisor: {a.supervisor_name||'Not assigned'}</AppText><AppText>Manager: {a.manager_name||'Not assigned'}</AppText><AppText>{new Date(a.starts_at).toLocaleString()} → {a.ends_at?new Date(a.ends_at).toLocaleString():'Present'}</AppText><AppText>{a.reason}</AppText></Card>)}
   <AppText variant="title">Assigned work</AppText>{(data.work||[]).map((w:WorkspaceData)=><Card key={w.id}><AppText>{w.title}</AppText><AppText>{human(w.status||'Not supplied')}</AppText></Card>)}
   <AppText variant="title">Verified work and driver records</AppText><AppText>Unmatched historical records require identity review before they appear here.</AppText>{data.records.map((l:WorkspaceData)=><Card key={l.id}><AppText variant="bodyStrong">{human(l.source_type)}</AppText><AppText>{recordLabel(l.record)}</AppText>{l.record&&Object.entries(l.record).filter(([k,v])=>k!=='id'&&v!=null).map(([k,v])=><AppText key={k}>{human(k)}: {String(v)}</AppText>)}</Card>)}<AppText variant="title">Activity history</AppText>{data.events.map((e:WorkspaceData)=><AppText key={e.id}>{new Date(e.created_at).toLocaleString()} · {e.actor_name||'Recorded user'} · {human(e.action)} · {e.details.reason||e.details.explanation||''}</AppText>)}
  </>}
 </ScrollView>{action&&<ActionForm key={`${owner}-${action.name}-${action.fine?.id||''}`} action={action.name} driverId={driverId} fine={action.fine} owner={owner} onClose={()=>setAction(null)} onSaved={()=>{setAction(null);load()}} />}</Screen>
}
export default withModuleGuard(DriverWorkspaceScreen,null)
