// Xero Flagger - content script

const STORAGE_KEY = 'xeroFlaggedInvoices';

// Extract bill ID from either URL format:
//   /app/!!Qb4n/bills/view/bill?id=UUID   (new SPA)
//   AccountsPayable/View.aspx?InvoiceID=UUID  (old)
function getInvoiceId() {
  const spa = window.location.search.match(/[?&]id=([a-f0-9-]+)/i);
  if (spa) return spa[1].toLowerCase();
  const legacy = window.location.search.match(/InvoiceID=([a-f0-9-]+)/i);
  if (legacy) return legacy[1].toLowerCase();
  return null;
}

function isInvoicePage() {
  return (
    /\/bills\/view\/bill/i.test(window.location.pathname) ||
    /AccountsPayable\/View\.aspx/i.test(window.location.pathname)
  );
}

function isAwaitingPaymentPage() {
  return /\/bills\/list\/awaiting-payment/i.test(window.location.href);
}

async function getFlagged() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      resolve(result[STORAGE_KEY] || {});
    });
  });
}

async function setFlagged(data) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
  });
}

// Scan legacy table/label layout for a field by its label text
function findLegacyField(labelText) {
  for (const el of document.querySelectorAll('td, th, label, dt, .label')) {
    if (el.textContent.trim().toLowerCase() === labelText.toLowerCase()) {
      return el.nextElementSibling || el.parentElement?.nextElementSibling;
    }
  }
  return null;
}

// ─── Invoice detail page ──────────────────────────────────────────────────────

async function initInvoicePage() {
  const invoiceId = getInvoiceId();
  if (!invoiceId) return;
  if (document.getElementById('xf-flag-btn')) return;

  // Capture scroll before the async gap — Xero's SPA scroll-restore can fire
  // during the await and scroll to the bottom; we want to lock to where we are now.
  const savedScroll = window.scrollY;

  const flagged = await getFlagged();

  const btn = document.createElement('button');
  btn.id = 'xf-flag-btn';
  btn.textContent = 'Flag';
  btn.className = flagged[invoiceId] ? 'xf-flagged' : '';

  btn.addEventListener('click', async () => {
    const current = await getFlagged();
    if (current[invoiceId]) {
      delete current[invoiceId];
      btn.className = '';
    } else {
      // Legacy: <a href="/Contacts/View/UUID">Company Name<input ...></a>
      // SPA: [data-automationid="contact-name"]
      const contactLink = document.querySelector('a[href*="/Contacts/View/"]');
      const contactSpa = document.querySelector('[data-automationid="contact-name"]');
      let label = invoiceId;
      if (contactLink) {
        // First text node only — element also contains hidden <input> children
        const textNode = [...contactLink.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
        label = textNode ? textNode.textContent.trim() : contactLink.textContent.trim();
      } else if (contactSpa) {
        label = contactSpa.textContent.trim();
      }

      // Reference: try SPA automationid first, then legacy table label
      const refEl = document.querySelector(
        '[data-automationid="reference-value"], ' +
        '[data-automationid="invoice-reference"], ' +
        '.invoice-reference-value'
      ) || findLegacyField('Reference');
      const reference = refEl ? refEl.textContent.trim() : '';

      // Amount due / total: try common selectors across SPA and legacy
      const amountEl = document.querySelector(
        '[data-automationid="amount-due-value"], ' +
        '[data-automationid="invoice-amount-due"], ' +
        '.total-amount-value, ' +
        '.xui-u-text-align-right.amount-cell .amount'
      ) || findLegacyField('Amount Due') || findLegacyField('Total');
      const amount = amountEl ? amountEl.textContent.trim() : '';

      current[invoiceId] = { label, reference, amount, flaggedAt: Date.now(), url: location.href };
      btn.className = 'xf-flagged';
    }
    await setFlagged(current);
  });

  // Insert next to Print PDF / Bill Options toolbar
  // XUI page heading right-content holds the action buttons
  const toolbar = document.querySelector(
    '.xui-pageheading--actions .xui-actions, ' +
    '.xui-pageheading--rightcontent, ' +
    '.xui-actions-layout, ' +
    'div.status .right'
  );
  if (toolbar) {
    toolbar.prepend(btn);
  } else {
    btn.classList.add('xf-fixed');
    document.body.appendChild(btn);
  }

  // Xero's own scroll-restoration fires after our code and overrides a single scrollTo.
  // Hold the position for ~600ms by intercepting the first externally-triggered scroll.
  let guarding = true;
  const guardScroll = () => {
    if (guarding) window.scrollTo(0, savedScroll);
  };
  window.addEventListener('scroll', guardScroll, { passive: true });
  window.scrollTo(0, savedScroll);
  setTimeout(() => {
    guarding = false;
    window.removeEventListener('scroll', guardScroll);
  }, 600);
}

// ─── Awaiting payment list page ───────────────────────────────────────────────

let _listObserver = null;
let _checkboxListener = null;

function teardownListObserver() {
  if (_listObserver) { _listObserver.disconnect(); _listObserver = null; }
  if (_checkboxListener) {
    document.removeEventListener('change', _checkboxListener, { capture: true });
    _checkboxListener = null;
  }
}

function buildRemoveUI() {
  // Remove any stale wrapper the SPA may have orphaned
  const stale = document.getElementById('xf-remove-wrapper') || document.getElementById('xf-remove-bar');
  if (stale) stale.remove();

  const btn = document.createElement('button');
  btn.id = 'xf-flag-btn-remove';
  btn.className = 'xui-button xui-button-standard xui-button-small';
  btn.textContent = 'De-Select Flagged';

  const status = document.createElement('span');
  status.id = 'xf-status';

  const bulkActions = document.querySelector('.xui-u-flex.bulk-actions-spacing');
  if (bulkActions) {
    const wrapper = document.createElement('div');
    wrapper.id = 'xf-remove-wrapper';
    wrapper.appendChild(btn);
    wrapper.appendChild(status);
    bulkActions.prepend(wrapper);
  } else {
    const bar = document.createElement('div');
    bar.id = 'xf-remove-bar';
    bar.appendChild(btn);
    bar.appendChild(status);
    const main = document.querySelector('main, [role="main"]');
    if (main) main.prepend(bar);
  }

  btn.addEventListener('click', () => {
    if (!btn.classList.contains('xf-active')) return;
    handleRemoveFlagged(status);
  });
}

// Recheck which flagged invoices have their checkbox ticked and update button state.
async function syncRemoveButton() {
  const btn = document.getElementById('xf-flag-btn-remove');
  if (!btn) return;
  if (btn.classList.contains('xf-done')) return;

  const flagged = await getFlagged();
  const flaggedIds = Object.keys(flagged);
  if (flaggedIds.length === 0) return;

  const rowMap = getRowsByInvoiceId();
  const anyChecked = flaggedIds.some(id => {
    const row = rowMap.get(id);
    if (!row) return false;
    const cb = row.querySelector('input[type="checkbox"]');
    return cb && cb.checked;
  });

  btn.classList.toggle('xf-active', anyChecked);
}

async function handleRemoveFlagged(statusEl) {
  statusEl.textContent = '';
  statusEl.className = '';

  const btn = document.getElementById('xf-flag-btn-remove');

  const flagged = await getFlagged();
  const flaggedIds = Object.keys(flagged);

  if (flaggedIds.length === 0) return;

  const rowMap = getRowsByInvoiceId();
  let unchecked = 0;
  let notFound = 0;

  for (const id of flaggedIds) {
    const row = rowMap.get(id);
    if (row) {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) checkbox.click();
      unchecked++;
    } else {
      notFound++;
    }
  }

  if (btn) {
    btn.classList.remove('xf-active');
    btn.classList.add('xf-success-flash');
    btn.textContent = '✓ De-selected';
    statusEl.textContent = '';
    statusEl.className = '';
    setTimeout(() => {
      btn.classList.remove('xf-success-flash');
      btn.textContent = 'De-Select Flagged';
      syncRemoveButton();
    }, 2500);
  }
}

// Returns Map of invoiceId → table row for all rows currently rendered.
// Xero SPA list links: href="/app/!!Qb4n/bills/view/bill?id=UUID"
function getRowsByInvoiceId() {
  const map = new Map();
  document.querySelectorAll('a[href*="bills/view/bill"]').forEach(a => {
    const m = a.href.match(/[?&]id=([a-f0-9-]+)/i);
    if (!m) return;
    const id = m[1].toLowerCase();
    const row = a.closest('tr, [role="row"]');
    if (row && !map.has(id)) map.set(id, row);
  });
  return map;
}

async function highlightFlaggedRows(flagged) {
  // Clear previous state
  document.querySelectorAll('.xf-row-flagged').forEach(el => el.classList.remove('xf-row-flagged'));
  document.querySelectorAll('.xf-flag-badge').forEach(el => el.remove());

  const ids = Object.keys(flagged);
  if (ids.length === 0) return;

  const badgedRows = new Set();

  document.querySelectorAll('a[href*="bills/view/bill"]').forEach(a => {
    const m = a.href.match(/[?&]id=([a-f0-9-]+)/i);
    if (!m || !flagged[m[1].toLowerCase()]) return;
    const row = a.closest('tr, [role="row"]');
    if (!row) return;

    row.classList.add('xf-row-flagged');

    // Only badge once per row, in the first matching cell (the From/supplier column)
    if (!badgedRows.has(row)) {
      badgedRows.add(row);
      const cell = a.closest('td, [role="cell"], [role="gridcell"]') || a.parentElement;
      if (cell) {
        const badge = document.createElement('span');
        badge.className = 'xf-flag-badge';
        badge.textContent = 'Flagged';
        badge.title = 'Will be de-selected by De-Select Flagged';
        cell.insertBefore(badge, cell.firstChild);
      }
    }
  });
}

async function initAwaitingPaymentPage() {
  teardownListObserver();

  // Poll for the toolbar up to 8 seconds, rebuilding the button each time
  // Xero re-renders the toolbar on filter/sort changes so we watch for that too.
  let attempts = 0;
  const MAX = 40; // 40 × 200ms = 8s

  const tryBuild = async () => {
    buildRemoveUI();
    const flagged = await getFlagged();
    highlightFlaggedRows(flagged);
    syncRemoveButton();
  };

  const poll = setInterval(async () => {
    attempts++;
    const toolbar = document.querySelector('.xui-u-flex.bulk-actions-spacing');
    const existing = document.getElementById('xf-flag-btn-remove');

    // Rebuild if: button missing, OR button is in fallback bar but toolbar now exists
    const inFallback = existing && !!document.getElementById('xf-remove-bar');
    if (!existing || (toolbar && inFallback)) {
      await tryBuild();
    } else if (!existing && attempts >= MAX) {
      clearInterval(poll);
      await tryBuild();
      return;
    }

    if (attempts >= MAX) clearInterval(poll);
  }, 200);

  // Watch for toolbar eviction, toolbar appearance, and checkbox state changes
  _listObserver = new MutationObserver(async () => {
    if (!isAwaitingPaymentPage()) return;
    const toolbar = document.querySelector('.xui-u-flex.bulk-actions-spacing');
    const existing = document.getElementById('xf-flag-btn-remove');
    const inFallback = existing && !!document.getElementById('xf-remove-bar');
    if (!existing || (toolbar && inFallback)) {
      await tryBuild();
    } else {
      syncRemoveButton();
    }
  });
  _listObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['checked'] });

  // Checkbox clicks don't always fire attribute mutations — listen directly too
  _checkboxListener = e => {
    if (e.target.type === 'checkbox') syncRemoveButton();
  };
  document.addEventListener('change', _checkboxListener, { capture: true });
}

// ─── Router ───────────────────────────────────────────────────────────────────

function init() {
  if (isInvoicePage()) {
    teardownListObserver();
    initInvoicePage();
  } else if (isAwaitingPaymentPage()) {
    initAwaitingPaymentPage();
  } else {
    teardownListObserver();
  }
}

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(init, 700);
  }
}).observe(document.body, { subtree: true, childList: true });

init();
