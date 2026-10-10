import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/app.css';
import App from './App.jsx';

if (/Mac/i.test(navigator.platform)) document.documentElement.classList.add('mac');

createRoot(document.getElementById('root')).render(<App />);
