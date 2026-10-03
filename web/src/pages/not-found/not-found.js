import { bootSubPage } from '../sub-page.js';
import markup from './not-found.html?raw';

/* --- Not found: the page Vercel serves for an unknown address (404.html) - */
bootSubPage({ 'not-found': { markup: markup } });
