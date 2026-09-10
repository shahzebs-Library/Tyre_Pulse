import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import PwaUpdatePrompt from '../../src/components/PwaUpdatePrompt.jsx';
import UpdateHistory from '../../src/components/ReleaseNotes.jsx';
import {LanguageProvider} from '../../src/contexts/LanguageContext.jsx';
import '../../src/index.css';
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/settings#updates']}><LanguageProvider><main style={{padding:24,maxWidth:1000,margin:'auto'}}><UpdateHistory /></main><PwaUpdatePrompt /></LanguageProvider></MemoryRouter>);
