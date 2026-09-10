import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import OdometerLogs from '../../src/pages/OdometerLogs.jsx';
import { LanguageProvider } from '../../src/contexts/LanguageContext.jsx';
import '../../src/index.css';
createRoot(document.getElementById('root')).render(<MemoryRouter><LanguageProvider><main style={{padding:24,maxWidth:1600,margin:'auto'}}><OdometerLogs /></main></LanguageProvider></MemoryRouter>);
