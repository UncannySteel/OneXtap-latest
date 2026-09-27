import { bootSubPage } from './sub-page.js';
import * as feedback from '../../src/features/feedback/feedback.js';
import { sendFeedback } from '../../src/app/backend.js';
import markup from '../../src/pages/contact/contact.html?raw';
import '../../src/pages/contact/contact.css';

/* --- Contact: the landing page's, with the feedback window wired to the
   same endpoint (POST /api/feedback) ------------------------------------ */
var page = bootSubPage({ 'contact': { markup: markup }, 'feedback': feedback });
feedback.initFeedback({ send: sendFeedback }).onToggle(page.hold);
