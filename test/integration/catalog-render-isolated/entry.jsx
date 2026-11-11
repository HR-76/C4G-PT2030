import React, { Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { ErrorState } from '../../../frontend/src/pages/Opportunities/CatalogReadDetails'

window.proof = { commits: [], ticks: 0 }
const originalInterval = window.setInterval
window.setInterval = (fn, delay, ...args) => originalInterval(() => { window.proof.ticks++; fn(...args) }, delay)
createRoot(document.getElementById('root')).render(
  <MemoryRouter><Profiler id="retry" onRender={(_id, phase, duration) => window.proof.commits.push({phase, duration})}>
    <ErrorState error={{status:429,retryAt:Date.now()+2000}} retry={()=>{}} />
  </Profiler></MemoryRouter>
)
