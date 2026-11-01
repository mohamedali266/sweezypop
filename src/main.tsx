import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  (window as Window & { __sweezypopInstallPrompt?: Event }).__sweezypopInstallPrompt = event;
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Service worker registration failed.', error);
    });
  });
}
