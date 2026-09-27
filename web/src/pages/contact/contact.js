import { bootSubPage } from '../sub-page.js';
import * as feedback from '../../features/feedback/feedback.js';
import { sendFeedback } from '../../app/backend.js';
import markup from './contact.html?raw';
import './contact.css';

/* --- Contact: the feedback window, and quick answers before it ----------
   A note goes to POST /api/feedback, which emails it to the team. */
var page = bootSubPage({ 'contact': { markup: markup }, 'feedback': feedback });
feedback.initFeedback({ send: sendFeedback }).onToggle(page.hold);
