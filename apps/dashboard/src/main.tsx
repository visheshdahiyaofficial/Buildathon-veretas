import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';
import ReportPage from './ReportPage';

// /report is the public help-request form; everything else is the command dashboard.
const isReport = location.pathname.replace(/\/+$/, '') === '/report';
if (isReport) document.title = 'CrisisPulse – Ask for help';

createRoot(document.getElementById('root')!).render(<StrictMode>{isReport ? <ReportPage /> : <App />}</StrictMode>);
