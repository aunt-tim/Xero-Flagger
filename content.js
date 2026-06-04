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

// ─── Invoice detail page ──────────────────────────────────────────────────────

async function initInvoicePage() {
  const invoiceId = getInvoiceId();
  if (!invoiceId) return;
  if (document.getElementById('xf-flag-btn')) return;

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
      const fromEl = document.querySelector(
        '.xui-pageheading--title, [data-automationid="contact-name"], h1'
      );
      const label = fromEl ? fromEl.textContent.trim() : invoiceId;
      current[invoiceId] = { label, flaggedAt: Date.now() };
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
    // Fallback: fixed position until SPA renders
    btn.classList.add('xf-fixed');
    document.body.appendChild(btn);
  }
}

// ─── Awaiting payment list page ───────────────────────────────────────────────

function buildRemoveUI() {
  if (document.getElementById('xf-flag-btn-remove')) return;

  const btn = document.createElement('button');
  btn.id = 'xf-flag-btn-remove';
  // Style to match Xero's XUI standard button
  btn.className = 'xui-button xui-button-standard xui-button-small';
  btn.textContent = 'Remove Flagged';

  const status = document.createElement('span');
  status.id = 'xf-status';

  // Insert into the Make payment button group container
  const bulkActions = document.querySelector('.xui-u-flex.bulk-actions-spacing');
  if (bulkActions) {
    const wrapper = document.createElement('div');
    wrapper.id = 'xf-remove-wrapper';
    wrapper.appendChild(btn);
    wrapper.appendChild(status);
    bulkActions.prepend(wrapper);
  } else {
    // Fallback bar if the toolbar hasn't rendered yet
    const bar = document.createElement('div');
    bar.id = 'xf-remove-bar';
    bar.appendChild(btn);
    bar.appendChild(status);
    const main = document.querySelector('main, [role="main"]');
    if (main) main.prepend(bar);
  }

  btn.addEventListener('click', () => handleRemoveFlagged(status));
}

async function handleRemoveFlagged(statusEl) {
  statusEl.textContent = '';
  statusEl.className = '';

  const flagged = await getFlagged();
  const flaggedIds = Object.keys(flagged);

  if (flaggedIds.length === 0) {
    statusEl.textContent = 'No invoices are flagged.';
    statusEl.className = 'xf-info';
    return;
  }

  const rowMap = getRowsByInvoiceId();
  let ticked = 0;
  let notFound = 0;

  for (const id of flaggedIds) {
    const row = rowMap.get(id);
    if (row) {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) checkbox.click();
      ticked++;
    } else {
      notFound++;
    }
  }

  if (ticked === 0) {
    statusEl.textContent = 'No flagged invoices found on this page.';
    statusEl.className = 'xf-info';
  } else {
    statusEl.textContent = `✓ ${ticked} selected.${notFound ? ` (${notFound} not on this page)` : ''}`;
    statusEl.className = 'xf-success';
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
  document.querySelectorAll('.xf-row-flagged').forEach(el => el.classList.remove('xf-row-flagged'));
  const ids = Object.keys(flagged);
  if (ids.length === 0) return;

  document.querySelectorAll('a[href*="bills/view/bill"]').forEach(a => {
    const m = a.href.match(/[?&]id=([a-f0-9-]+)/i);
    if (m && flagged[m[1].toLowerCase()]) {
      const row = a.closest('tr, [role="row"]');
      if (row) row.classList.add('xf-row-flagged');
    }
  });
}

async function initAwaitingPaymentPage() {
  await new Promise(r => setTimeout(r, 900));
  buildRemoveUI();
  const flagged = await getFlagged();
  highlightFlaggedRows(flagged);
}

// ─── Router ───────────────────────────────────────────────────────────────────

function init() {
  if (isInvoicePage()) {
    initInvoicePage();
  } else if (isAwaitingPaymentPage()) {
    initAwaitingPaymentPage();
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
