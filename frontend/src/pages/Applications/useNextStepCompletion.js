import { useState } from 'react'

const actionsByStatus={
 IDENTIFIED:['edit','transition'],
 INTENTION:['team','transition'],
 PREPARATION:['team','partners','documents','transition'],
 SUBMITTED:['documents','transition'],
}

export default function useNextStepCompletion(userId,organizationId,applicationId,status,statusChangedAt){
 const key=JSON.stringify(['application-next-step',userId,organizationId,applicationId,status,statusChangedAt||null])
 const [completedKey,setCompletedKey]=useState(null)
 let completed=completedKey===key
 try{completed ||= sessionStorage.getItem(key)==='completed'}catch{/* In-memory completion still works when storage is unavailable. */}
 const complete=action=>{
  if(!actionsByStatus[status]?.includes(action))return
  setCompletedKey(key)
  try{sessionStorage.setItem(key,'completed')}catch{/* A UI preference must not turn a successful mutation into an error. */}
 }
 return {completed,complete}
}
