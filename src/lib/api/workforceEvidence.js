import {supabase,ServiceError,unwrap} from './_client'
const BUCKET='workforce-evidence'
const ACCEPTED=new Set(['image/jpeg','image/png','application/pdf'])
export async function listWorkEvidence(reportId){
 if(!reportId)return []
 return unwrap(await supabase.from('workforce_evidence').select('id,report_id,entry_id,file_name,mime_type,byte_size,object_path,created_at').eq('report_id',reportId).order('created_at',{ascending:false}).limit(150))
}
export async function uploadWorkEvidence({report,file,entryId=null}){
 if(!report?.id||!report.organisation_id||!report.employee_id)throw new ServiceError('Report identity missing')
 if(!['draft','returned'].includes(report.status))throw new ServiceError('Submitted reports cannot be changed')
 if(!file||!ACCEPTED.has(file.type)||file.size<=0||file.size>10485760)throw new ServiceError('Upload a JPEG, PNG or PDF up to 10 MB')
 const objectPath=`${report.organisation_id}/${report.employee_id}/${report.id}/${crypto.randomUUID()}`
 const {error:uploadError}=await supabase.storage.from(BUCKET).upload(objectPath,file,{contentType:file.type,upsert:false})
 if(uploadError)throw new ServiceError('Could not upload evidence',uploadError.code,uploadError)
 const {data,error:insertError}=await supabase.from('workforce_evidence').insert({
  report_id:report.id,entry_id:entryId,employee_id:report.employee_id,
  object_path:objectPath,file_name:file.name.slice(0,240),mime_type:file.type,byte_size:file.size
 }).select('id,report_id,entry_id,file_name,mime_type,byte_size,object_path,created_at').single()
 if(insertError){
  // Best-effort removal; never pretend the evidence was saved.
  await supabase.storage.from(BUCKET).remove([objectPath])
  throw new ServiceError('Evidence metadata could not be saved',insertError.code,insertError)
 }
 return data
}
export async function openWorkEvidence(objectPath){
 const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(objectPath,60)
 if(error||!data?.signedUrl)throw new ServiceError('Evidence not accessible',error?.code,error)
 return data.signedUrl
}
