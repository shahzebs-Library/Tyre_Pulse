import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import InspectionPlanner from '../src/pages/InspectionPlanner'
import '../src/index.css'
const ar = new URLSearchParams(location.search).get('lang') === 'ar'
document.documentElement.dir = ar ? 'rtl' : 'ltr'
document.documentElement.lang = ar ? 'ar' : 'en'
createRoot(document.getElementById('root')).render(<MemoryRouter><main style={{padding: 20, maxWidth: 1440, margin: 'auto'}}><InspectionPlanner /></main></MemoryRouter>)
