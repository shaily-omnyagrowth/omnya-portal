import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/instrument-sans/wght.css';
import 'goey-toast/styles.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/utilities.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    setTimeout(() => navigator.serviceWorker.register('/sw.js').catch(() => {}), 3000);
  });
}
