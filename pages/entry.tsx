import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

window.__YAHTZEE_PAGES__ = true;
createRoot(document.getElementById('root')!).render(<Home />);

// Lets the app open and keep scoring without an internet connection.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

declare global {
  interface Window {
    __YAHTZEE_PAGES__?: boolean;
  }
}
