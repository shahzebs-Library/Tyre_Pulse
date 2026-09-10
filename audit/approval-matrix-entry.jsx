import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import ApprovalMatrix from '../src/pages/ApprovalMatrix'
import '../src/index.css'

createRoot(document.getElementById('root')).render(
  <MemoryRouter><main className="p-4"><p className="mb-4 text-sm">Isolated Approval Matrix verification — test fixtures only</p><ApprovalMatrix /></main></MemoryRouter>,
)
