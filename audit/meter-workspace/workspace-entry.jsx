import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import MyWorkspace from '../../src/pages/MyWorkspace.jsx';
import { WorkspaceNavigationContext } from '../../src/contexts/WorkspaceNavigationContext.jsx';
import { LanguageProvider } from '../../src/contexts/LanguageContext.jsx';
import '../../src/index.css';
const nav = [{to:'/vehicle-washing',label:'Vehicle Washing'},{to:'/fleet-master',label:'Fleet Master'},{to:'/odometer-logs',label:'Odometer Logs'},{to:'/engine-hours',label:'Engine Hours'}];
createRoot(document.getElementById('root')).render(<MemoryRouter><LanguageProvider><WorkspaceNavigationContext.Provider value={nav}><main style={{padding:24}}><MyWorkspace /></main></WorkspaceNavigationContext.Provider></LanguageProvider></MemoryRouter>);
