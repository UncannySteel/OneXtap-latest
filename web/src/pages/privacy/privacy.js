import { bootSubPage } from '../sub-page.js';
import markup from './privacy.html?raw';

/* --- Privacy: what stays on the device, and the one thing that leaves ---- */
bootSubPage({ 'privacy': { markup: markup } });
