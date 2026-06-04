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
      const fromEl = document.querySelector('table td a, .from a, [data-automationid="contact-name"]');
      const label = fromEl ? fromEl.textContent.trim() : invoiceId;
      current[invoiceId] = { label, flaggedAt: Date.now() };
      btn.className = 'xf-flagged';
    }
    await setFlagged(current);
  });

  const toolbar = document.querySelector('.invoice-options, .x-invoice-header, .invoice-header, [class*="invoiceHeader"], .button-group');
  if (toolbar) {
    toolbar.prepend(btn);
  } else {
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

  btn.addEventListener('click', () => handleRemoveFlagged(btn, status));
}

async function handleRemoveFlagged(btn, statusEl) {
  statusEl.textContent = '';
  statusEl.className = '';

  const flagged = await getFlagged();
  const remaining = new Set(Object.keys(flagged));

  if (remaining.size === 0) {
    statusEl.textContent = 'No invoices are flagged.';
    statusEl.className = 'xf-info';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Working…';

  let totalTicked = 0;
  let pageNum = 1;

  // Rewind to page 1 before starting
  await goToPage(1);

  while (remaining.size > 0) {
    await waitForListLoad();

    statusEl.textContent = `Scanning page ${pageNum}…`;
    statusEl.className = 'xf-info';

    const rowMap = getRowsByInvoiceId();

    for (const id of [...remaining]) {
      const row = rowMap.get(id);
      if (row) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox && !checkbox.checked) checkbox.click();
        totalTicked++;
        remaining.delete(id);
      }
    }

    // If all flagged found, stop early
    if (remaining.size === 0) break;

    const nextBtn = getNextPageButton();
    if (!nextBtn) break; // no more pages

    nextBtn.click();
    pageNum++;
    // Wait for the page transition before rescanning
    await new Promise(r => setTimeout(r, 300));
  }

  btn.disabled = false;
  btn.textContent = 'Remove Flagged';

  if (totalTicked === 0) {
    statusEl.textContent = 'None of the flagged invoices were found in this list.';
    statusEl.className = 'xf-info';
  } else if (remaining.size === 0) {
    statusEl.textContent = `✓ All ${totalTicked} flagged invoice${totalTicked !== 1 ? 's' : ''} selected across ${pageNum} page${pageNum !== 1 ? 's' : ''}.`;
    statusEl.className = 'xf-success';
  } else {
    statusEl.textContent = `✓ ${totalTicked} selected. ${remaining.size} flagged invoice${remaining.size !== 1 ? 's' : ''} not found in this list.`;
    statusEl.className = 'xf-warn';
  }
}

// Returns a Map of invoiceId → table row for rows currently rendered
function getRowsByInvoiceId() {
  const map = new Map();
  document.querySelectorAll('a[href*="InvoiceID="], a[href*="invoiceId="]').forEach(a => {
    const m = a.href.match(/[Ii]nvoice[Ii][Dd]=([a-f0-9-]+)/i);
    if (!m) return;
    const id = m[1].toLowerCase();
    const row = a.closest('tr, [role="row"], li');
    if (row && !map.has(id)) map.set(id, row);
  });
  return map;
}

// Find the "next page" button in Xero's pagination controls
function getNextPageButton() {
  // Xero uses various pagination patterns — try common selectors
  const selectors = [
    'button[aria-label="Next page"]',
    'a[aria-label="Next page"]',
    '[data-automationid="pagination-next"]',
    'button.pagination-next',
    'a.pagination-next',
    // Generic: a button/link containing only "›" or "Next" that isn't disabled
    'nav button:not([disabled])',
    'nav a',
  ];

  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const text = el.textContent.trim();
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      if (
        label.includes('next') ||
        text === '›' || text === '»' || text === '>' ||
        text.toLowerCase() === 'next'
      ) {
        if (!el.disabled && !el.closest('[disabled]') && !el.classList.contains('disabled')) {
          return el;
        }
      }
    }
  }
  return null;
}

// Navigate to page 1 if pagination controls support it
async function goToPage(pageNumber) {
  if (pageNumber !== 1) return;
  const selectors = [
    'button[aria-label="First page"]',
    'a[aria-label="First page"]',
    '[data-automationid="pagination-first"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && !el.disabled) { el.click(); await new Promise(r => setTimeout(r, 300)); return; }
  }
  // Fallback: find page 1 button by text
  for (const el of document.querySelectorAll('nav button, nav a')) {
    if (el.textContent.trim() === '1') { el.click(); await new Promise(r => setTimeout(r, 300)); return; }
  }
}

// Wait for the list rows to be present after a page change
function waitForListLoad(timeout = 3000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      const rows = document.querySelectorAll('a[href*="InvoiceID="], a[href*="invoiceId="]');
      if (rows.length > 0) return resolve();
      if (Date.now() - start > timeout) return resolve();
      setTimeout(check, 150);
    };
    check();
  });
}

async function highlightFlaggedRows(flagged) {
  document.querySelectorAll('.xf-row-flagged').forEach(el => el.classList.remove('xf-row-flagged'));
  const ids = Object.keys(flagged);
  if (ids.length === 0) return;

  document.querySelectorAll('a[href*="InvoiceID="], a[href*="invoiceId="]').forEach(a => {
    const m = a.href.match(/[Ii]nvoice[Ii][Dd]=([a-f0-9-]+)/i);
    if (m && flagged[m[1].toLowerCase()]) {
      const row = a.closest('tr, [role="row"], li');
      if (row) row.classList.add('xf-row-flagged');
    }
  });
}

async function initAwaitingPaymentPage() {
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

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(init, 600);
  }
}).observe(document.body, { subtree: true, childList: true });

init();
