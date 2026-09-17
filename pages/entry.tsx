import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

window.__YAHTZEE_API_ORIGIN__ = 'https://yahtzee-table.frenchbear.chatgpt.site';
createRoot(document.getElementById('root')!).render(<Home />);

declare global {
  interface Window {
    __YAHTZEE_API_ORIGIN__?: string;
  }
}
