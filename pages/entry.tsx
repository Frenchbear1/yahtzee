import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

window.__YAHTZEE_PAGES__ = true;
createRoot(document.getElementById('root')!).render(<Home />);

declare global {
  interface Window {
    __YAHTZEE_PAGES__?: boolean;
  }
}
