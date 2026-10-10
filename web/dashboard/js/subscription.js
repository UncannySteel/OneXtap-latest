import { plans } from './config.js';
import * as services from './services.js';
import { storage, toast } from './util.js';

// Back from a paid checkout, the account turns Pro only when Dodo's webhook
// lands. Until then "Upgrade to Pro" would start a second checkout, and a
// second subscription (server/subscriptionGuard.js cancels that one, but the
// customer has still paid twice). So for a while, in every tab of this
// browser, the panel says the payment is being confirmed instead.
const PAYMENT_PENDING_KEY = 'onextap_payment_pending';
const PAYMENT_PENDING_MS = 15 * 60 * 1000;

function paymentPending(user) {
  const pending = storage.get(PAYMENT_PENDING_KEY, null);
  return Boolean(pending && user?.id && pending.userId === user.id && Date.now() - pending.at < PAYMENT_PENDING_MS);
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const formatDate = (iso) => dateFormat.format(new Date(`${iso}T00:00`));

function statusText(plan, user) {
  if (plan.price === '$0') return `You’re on ${plan.name}: free forever, no card on file.`;
  if (user.cancelAtPeriodEnd) {
    return user.renewsOn
      ? `You’re on ${plan.name} until ${formatDate(user.renewsOn)}. After that you’ll move to Standard, and you won’t be charged again.`
      : `You’re on ${plan.name} until the end of this billing period. After that you’ll move to Standard.`;
  }
  const renews = user.renewsOn ? ` It renews on ${formatDate(user.renewsOn)}.` : '';
  return `You’re on ${plan.name}, ${plan.price} ${plan.period}.${renews}`;
}

/**
 * The Manage subscription panel: the plan you're on, both plans side by side
 * (as the landing page prices them), and a button to move to the other one.
 *
 *   Standard → "Upgrade to Pro" goes to Dodo's checkout.
 *   Pro      → "Switch to Standard" cancels at the end of the paid period;
 *              until that date the panel says so, and "Keep Pro" undoes it.
 *
 * `getUser()` returns the signed-in user; `onChange(change)` gets the new
 * { plan, renewsOn, cancelAtPeriodEnd, credits? } once a move goes through.
 */
export function initSubscription({ dialog, getUser, onChange }) {
  const status = dialog.querySelector('[data-sub="status"]');
  const list = dialog.querySelector('[data-sub="plans"]');
  const billing = dialog.querySelector('[data-sub="billing"]');
  const done = dialog.querySelector('[data-sub="done"]');

  function ctaFor(plan, i, rank, user) {
    const isCurrent = i === rank;
    if (isCurrent) {
      return user.cancelAtPeriodEnd && plan.price !== '$0'
        ? `<button type="button" class="btn btn-solid plan-cta" data-plan="${plan.id}">Keep ${plan.name} <span class="btn-arrow" aria-hidden="true">→</span></button>`
        : '';
    }
    if (i > rank) {
      if (paymentPending(user)) {
        return `<p class="plan-note">Payment received. ${plan.name} turns on in a moment, so there’s no need to pay again.</p>`;
      }
      return `<button type="button" class="btn btn-solid plan-cta" data-plan="${plan.id}">Upgrade to ${plan.name} <span class="btn-arrow" aria-hidden="true">→</span></button>`;
    }
    // A move down that is already scheduled has nothing left to press.
    if (user.cancelAtPeriodEnd) {
      const from = user.renewsOn ? `From ${formatDate(user.renewsOn)}` : 'At the end of this period';
      return `<p class="plan-note">${from}</p>`;
    }
    return `<button type="button" class="btn btn-ghost plan-cta" data-plan="${plan.id}">Switch to ${plan.name}</button>`;
  }

  function render() {
    const user = getUser();
    const current = plans.find((p) => p.id === user.plan) ?? plans[0];
    const rank = plans.indexOf(current);
    status.textContent = statusText(current, user);
    list.innerHTML = plans
      .map((plan, i) => {
        const isCurrent = plan === current;
        return `<li class="plan"${isCurrent ? ' data-current' : ''}>
            <div class="plan-head">
              <h3 class="label plan-name">${plan.name}</h3>
              ${isCurrent ? '<span class="plan-badge">Current plan</span>' : ''}
            </div>
            <div class="plan-price"><span class="display">${plan.price}</span> <span class="plan-period">${plan.period}</span></div>
            <ul class="plan-features">${plan.features.map((f) => `<li>${f}</li>`).join('')}</ul>
            ${ctaFor(plan, i, rank, user)}
          </li>`;
      })
      .join('');
    // Billing and invoices only mean something on a paid plan.
    billing.hidden = current.price === '$0';
  }

  list.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-plan]');
    if (!button) return;
    const user = getUser();
    const plan = plans.find((p) => p.id === button.dataset.plan);
    const keeping = plan.id === user.plan;
    list.querySelectorAll('button').forEach((b) => (b.disabled = true));
    button.firstChild.textContent = keeping ? 'Keeping… ' : button.classList.contains('btn-solid') ? 'Opening checkout… ' : 'Switching… ';
    try {
      const change = await services.changePlan(plan.id, user);
      onChange(change);
      if (keeping) toast(`You’re keeping ${plan.name}.`);
      else if (change.cancelAtPeriodEnd) {
        toast(change.renewsOn
          ? `Pro runs until ${formatDate(change.renewsOn)}, then you’re on Standard.`
          : 'Pro runs to the end of this period, then you’re on Standard.');
      } else toast(`You’re on ${plans.find((p) => p.id === change.plan)?.name ?? plan.name} now.`);
    } catch (err) {
      toast(err?.message ? `Couldn’t change your plan: ${err.message}` : 'Couldn’t change your plan. Try again.', 'error');
    }
    render();
    // The pressed button is gone with the re-render; keep focus in the panel.
    done.focus();
  });

  billing.addEventListener('click', async () => {
    toast('Opening billing…');
    try {
      await services.openSubscriptionPortal();
    } catch (err) {
      toast(err?.message || 'Couldn’t open billing. Try again.', 'error');
    }
  });

  return {
    open() {
      render();
      if (!dialog.open) dialog.showModal();
    },
    /** Re-renders an open panel (the plan changed underneath it). */
    refresh() {
      if (dialog.open) render();
    },
    /** Back from checkout with a payment: hold "Upgrade" until Pro shows up. */
    markPaymentPending() {
      storage.set(PAYMENT_PENDING_KEY, { userId: getUser()?.id, at: Date.now() });
      if (dialog.open) render();
    },
    /** Pro arrived, or the payment was cancelled: "Upgrade" is back. */
    clearPaymentPending() {
      storage.set(PAYMENT_PENDING_KEY, null);
      if (dialog.open) render();
    },
  };
}
