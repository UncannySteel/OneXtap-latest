import React from 'react';
import { ArrowRight, ArrowUpRight, Mail, MessageSquare } from 'lucide-react';
import { getIconUrl, openChromeWebStore } from '../../extensionClient';

/**
 * The closing footer.
 *
 * It absorbs four things that used to be four separate full-width bands — the
 * "ready to transform" call to action, the Feedback section, the Contact
 * section and the old link-column footer. Every word of that copy is carried
 * over unchanged; what changed is that the page now ends once instead of four
 * times. The structure follows the big-closing-footer pattern the brief points
 * at: one oversized statement, then the ways to reach a person, then the
 * columns, then a legal line under a full-width wordmark.
 *
 * `id="feedback"` and `id="contact"` move here with their content, so both nav
 * entries and both footer links still land on the thing they name.
 *
 * @param {object} props
 * @param {(id: string) => void} props.onNavigate Smooth-scrolls to a section id.
 * @param {(mode: 'signin'|'signup') => void} props.onOpenAuth
 * @param {string} props.contactEmail
 * @param {() => void} props.onOpenFeedback Opens the feedback dialog.
 */
const SiteFooter = ({ onNavigate, onOpenAuth, contactEmail, onOpenFeedback }) => (
  <footer className="ot-ft">
    <div className="ot-ft-inner">
      {/* 1 — the statement */}
      <section className="ot-ft-cta">
        <h2 className="ot-ft-cta-h">
          Ready to transform
          <br />
          your job <em>search?</em>
        </h2>
        <p className="ot-ft-cta-p">Join thousands of job seekers applying faster with Onextap.</p>
        <button type="button" onClick={openChromeWebStore} className="ot-ft-cta-btn">
          Get the Extension
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <p className="ot-ft-chips">
          <span>Available for</span>
          <span className="ot-ft-chip">Chrome</span>
          <span className="ot-ft-chip">Opera</span>
          <span className="ot-ft-chip ot-ft-chip--soon">Safari — Soon</span>
        </p>
      </section>

      {/* 2 — the two ways to reach a person. Feedback first: it is the one the
          brief asks the footer to carry, and the one that changes the product. */}
      <div className="ot-ft-talk">
        <section id="feedback" className="ot-ft-card scroll-mt-20">
          <p className="ot-ft-eyebrow">Feedback</p>
          <h3 className="ot-ft-card-h">
            Tell us what to <em>build next.</em>
          </h3>
          <p className="ot-ft-card-p">
            Hit a form Onextap could not fill, or an answer that came out wrong? Send it over. Field
            matching gets better from exactly those reports.
          </p>
          <button type="button" onClick={onOpenFeedback} className="ot-ft-btn ot-ft-btn--solid">
            <MessageSquare size={17} aria-hidden="true" />
            Send feedback
          </button>
        </section>

        <section id="contact" className="ot-ft-card scroll-mt-20">
          <p className="ot-ft-eyebrow">Contact</p>
          <h3 className="ot-ft-card-h">
            Questions go to <em>a person.</em>
          </h3>
          <p className="ot-ft-card-p">
            Support, billing, press, or a privacy request — one inbox, no ticket queue.
          </p>
          <a href={`mailto:${contactEmail}`} className="ot-ft-btn">
            <Mail size={17} aria-hidden="true" />
            {contactEmail}
          </a>
        </section>
      </div>

      {/* 3 — columns */}
      <div className="ot-ft-cols">
        <div className="ot-ft-brand">
          <p className="ot-ft-wordmark-sm">
            <img src={getIconUrl()} alt="" />
            Onextap
          </p>
          <p>
            Your personal job application copilot. Apply faster with AI-powered autofill and
            personalization.
          </p>
        </div>

        <nav className="ot-ft-col" aria-label="Product">
          <h4>Product</h4>
          <button type="button" onClick={() => onNavigate('features')}>Features</button>
          <button type="button" onClick={() => onNavigate('how-it-works')}>How it works</button>
          <button type="button" onClick={() => onNavigate('pricing')}>Pricing</button>
          <button type="button" onClick={() => onNavigate('faq')}>FAQ</button>
        </nav>

        <nav className="ot-ft-col" aria-label="Company">
          <h4>Company</h4>
          <button type="button" onClick={() => onNavigate('about')}>About</button>
          <button type="button" onClick={() => onNavigate('contact')}>Contact</button>
          <button type="button" onClick={() => onNavigate('feedback')}>Feedback</button>
        </nav>

        <nav className="ot-ft-col" aria-label="Get started">
          <h4>Get Started</h4>
          <button type="button" onClick={openChromeWebStore}>Install Extension</button>
          <button type="button" onClick={() => onOpenAuth('signin')}>Sign In</button>
          <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </nav>
      </div>

      {/* 4 — the wordmark and the legal line. Decorative: the real name is in
          the brand column above, so this must not be read out twice. */}
      <p className="ot-ft-wordmark" aria-hidden="true">ONEXTAP</p>

      <div className="ot-ft-legal">
        <p>&copy; {new Date().getFullYear()} Onextap. All rights reserved.</p>
        <p>Chrome · Opera · Safari coming soon</p>
      </div>
    </div>
  </footer>
);

export default SiteFooter;
