// Xero Flagger - content script

const STORAGE_KEY = 'xeroFlaggedInvoices';

function getInvoiceId() {
  const match = window.location.search.match(/InvoiceID=([a-f0-9-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function isInvoicePage() {
  return /AccountsPayable\/View\.aspx/i.test(window.location.pathname);
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

  const flagged = await getFlagged();
  const isFlagged = !!flagged[invoiceId];

  const btn = document.createElement('button');
  btn.id = 'xf-flag-btn';
  btn.textContent = 'Flag';
  btn.className = isFlagged ? 'xf-flagged' : '';

  btn.addEventListener('click', async () => {
    const current = await getFlagged();
    if (current[invoiceId]) {
      delete current[invoiceId];
      btn.className = '';
    } else {
      // Grab a label for display in the awaiting-payment list
      const fromEl = document.querySelector('table td a, .from a, [data-automationid="contact-name"]');
      const label = fromEl ? fromEl.textContent.trim() : invoiceId;
      current[invoiceId] = { label, flaggedAt: Date.now() };
      btn.className = 'xf-flagged';
    }
    await setFlagged(current);
  });

  // Insert the button into the page — try the print/options toolbar first
  const toolbar = document.querySelector('.invoice-options, .x-invoice-header, .invoice-header, [class*="invoiceHeader"], .button-group');
  if (toolbar) {
    toolbar.prepend(btn);
  } else {
    // Fallback: fixed position
    btn.style.position = 'fixed';
    btn.style.top = '80px';
    btn.style.right = '24px';
    btn.style.zIndex = '99999';
    document.body.appendChild(btn);
  }
}

// ─── Awaiting payment list page ───────────────────────────────────────────────

function buildRemoveUI(container) {
  if (document.getElementById('xf-remove-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'xf-remove-bar';

  const btn = document.createElement('button');
  btn.id = 'xf-remove-btn';
  btn.textContent = 'Remove Flagged';

  const status = document.createElement('span');
  status.id = 'xf-status';

  bar.appendChild(btn);
  bar.appendChild(status);
  container.prepend(bar);

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

  // Collect invoice IDs currently visible in the list
  const presentIds = getPresentInvoiceIds();

  // Remove flagged invoices that are no longer in the list
  let removed = 0;
  let stillPresent = 0;

  for (const id of flaggedIds) {
    if (!presentIds.has(id)) {
      delete flagged[id];
      removed++;
    } else {
      stillPresent++;
    }
  }

  await setFlagged(flagged);

  if (stillPresent === 0) {
    statusEl.textContent = `✓ Done — ${removed} invoice${removed !== 1 ? 's' : ''} cleared.`;
    statusEl.className = 'xf-success';
  } else {
    statusEl.textContent = `⚠ ${stillPresent} flagged invoice${stillPresent !== 1 ? 's are' : ' is'} still in the list. ${removed} cleared.`;
    statusEl.className = 'xf-warn';
  }

  // Re-highlight remaining flagged rows
  highlightFlaggedRows(flagged);
}

function getPresentInvoiceIds() {
  const ids = new Set();
  // Xero bill list rows contain an eye icon link or a row link with the invoice ID in the href
  document.querySelectorAll('a[href*="InvoiceID="], a[href*="invoiceId="]').forEach(a => {
    const m = a.href.match(/[Ii]nvoice[Ii][Dd]=([a-f0-9-]+)/i);
    if (m) ids.add(m[1].toLowerCase());
  });
  return ids;
}

async function highlightFlaggedRows(flagged) {
  // Remove existing highlights
  document.querySelectorAll('.xf-row-flagged').forEach(el => el.classList.remove('xf-row-flagged'));

  const ids = Object.keys(flagged);
  if (ids.length === 0) return;

  document.querySelectorAll('a[href*="InvoiceID="], a[href*="invoiceId="]').forEach(a => {
    const m = a.href.match(/[Ii]nvoice[Ii][Dd]=([a-f0-9-]+)/i);
    if (m && flagged[m[1].toLowerCase()]) {
      // Walk up to the table row
      let row = a.closest('tr, [role="row"], li');
      if (row) row.classList.add('xf-row-flagged');
    }
  });
}

async function initAwaitingPaymentPage() {
  // Wait briefly for React/Angular to render the list
  await new Promise(r => setTimeout(r, 800));

  const container = document.querySelector('main, .x-main-content, [class*="content"], body');
  if (container) buildRemoveUI(container);

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

// Xero is a SPA — listen for URL changes
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Small delay to let the SPA render
    setTimeout(init, 600);
  }
}).observe(document.body, { subtree: true, childList: true });

init();
