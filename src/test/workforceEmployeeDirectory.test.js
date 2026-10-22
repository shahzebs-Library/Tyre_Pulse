import {describe,it,expect} from 'vitest'
import {employeeLabel,findAssignableEmployees} from '../lib/workforceEmployeeDirectory'
const people=[
 {id:'uuid-1',employee_id:'E-009',full_name:'Muhammad Ali Khan',username:'mkhan',role:'Technician',site:'Riyadh',approved:true,locked:false},
 {id:'uuid-2',employee_id:'E-010',full_name:'Ahmed Saeed',username:'asaeed',role:'Driver',site:'Diriyah',approved:true,locked:false},
 {id:'uuid-3',employee_id:'E-011',full_name:'Locked Person',role:'Driver',approved:true,locked:true},
 {id:'uuid-4',employee_id:'E-012',full_name:'Pending Person',role:'Technician',approved:false,locked:false}
]
describe('workforce assignment directory',()=>{
 it('matches employee IDs, complete names, usernames and account IDs',()=>{
  for(const search of ['E-009','Muhammad Ali Khan','MKHAN','uuid-1']){
   expect(findAssignableEmployees(people,{search}).map(p=>p.id)).toEqual(['uuid-1'])
  }
 })
 it('filters by recorded role without introducing guessed designations',()=>{
  expect(findAssignableEmployees(people,{role:'Driver'}).map(p=>p.id)).toEqual(['uuid-2'])
  expect(findAssignableEmployees(people,{role:'Technician',search:'Ahmed'})).toEqual([])
 })
 it('never offers locked or unapproved accounts',()=>{
  expect(findAssignableEmployees(people).map(p=>p.id)).toEqual(['uuid-2','uuid-1'])
 })
 it('displays full identity and designation',()=>{
  expect(employeeLabel(people[0])).toContain('Muhammad Ali Khan | ID: E-009 | Technician')
 })
})
