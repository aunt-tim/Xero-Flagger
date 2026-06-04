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
    statusEl.textContent = `✓ ${ticked} invoice${ticked !== 1 ? 's' : ''} selected.${notFound ? ` (${notFound} not on this page)` : ''}`;
    statusEl.className = 'xf-success';
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
