// Role is the actual profiles field; job designation is not separately recorded.
export const employeeLabel = p => [p.full_name || p.username || 'Unnamed account', p.employee_id ? `ID: ${p.employee_id}` : null, p.role || null, p.site || null].filter(Boolean).join(' · ')
export function findAssignableEmployees(employees, {search='',role='all'}={}) {
 const term=String(search).trim().toLocaleLowerCase()
 return employees.filter(p=>{
  if(p.approved!==true||p.locked===true) return false
  if(role!=='all'&&p.role!==role) return false
  return !term || [p.employee_id,p.full_name,p.username,p.id,p.role,p.site].some(v=>String(v||'').toLocaleLowerCase().includes(term))
 }).sort((a,b)=>String(a.full_name||a.username||'').localeCompare(String(b.full_name||b.username||'')))
}
