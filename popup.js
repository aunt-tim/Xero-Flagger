const STORAGE_KEY = 'xeroFlaggedInvoices';

let sortCol = 'flaggedAt';
let sortDir = 'desc'; // 'asc' | 'desc'

async function getFlagged() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], r => resolve(r[STORAGE_KEY] || {}));
  });
}

async function setFlagged(data) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
  });
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function parseAmount(str) {
  if (!str) return -Infinity;
  const n = parseFloat(str.replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? -Infinity : n;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const [, ai] = a;
    const [, bi] = b;
    let av, bv;

    if (sortCol === 'flaggedAt') {
      av = ai.flaggedAt || 0;
      bv = bi.flaggedAt || 0;
    } else if (sortCol === 'amount') {
      av = parseAmount(ai.amount);
      bv = parseAmount(bi.amount);
    } else {
      av = (ai[sortCol] || '').toLowerCase();
      bv = (bi[sortCol] || '').toLowerCase();
    }

    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

async function render() {
  const flagged = await getFlagged();
  const entries = Object.entries(flagged);

  const tableWrap = document.getElementById('table-wrap');
  const emptyState = document.getElementById('empty-state');
  const tbody = document.getElementById('invoice-tbody');
  const countLabel = document.getElementById('count-label');
  const clearBtn = document.getElementById('clear-all-btn');

  if (entries.length === 0) {
    tableWrap.classList.add('hidden');
    emptyState.classList.remove('hidden');
    countLabel.textContent = '';
    clearBtn.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  tableWrap.classList.remove('hidden');
  countLabel.textContent = `${entries.length} invoice${entries.length !== 1 ? 's' : ''} flagged`;
  clearBtn.classList.remove('hidden');

  updateSortHeaders();

  const sorted = sortEntries(entries);
  tbody.innerHTML = '';

  for (const [id, inv] of sorted) {
    const tr = document.createElement('tr');

    // Supplier
    const tdS = document.createElement('td');
    tdS.className = 'td-supplier';
    if (inv.url) {
      const a = document.createElement('a');
      a.href = inv.url;
      a.textContent = inv.label || id;
      a.target = '_blank';
      tdS.appendChild(a);
    } else {
      tdS.textContent = inv.label || id;
    }
    tr.appendChild(tdS);

    // Reference
    const tdR = document.createElement('td');
    tdR.className = 'td-ref';
    tdR.textContent = inv.reference || '—';
    tdR.title = inv.reference || '';
    tr.appendChild(tdR);

    // Amount
    const tdA = document.createElement('td');
    tdA.className = 'td-amount';
    tdA.textContent = inv.amount || '—';
    tr.appendChild(tdA);

    // Date flagged
    const tdD = document.createElement('td');
    tdD.className = 'td-date';
    tdD.textContent = formatDate(inv.flaggedAt);
    tr.appendChild(tdD);

    // Unflag
    const tdU = document.createElement('td');
    tdU.className = 'td-action';
    const btn = document.createElement('button');
    btn.className = 'unflag-btn';
    btn.textContent = 'Unflag';
    btn.addEventListener('click', async () => {
      const current = await getFlagged();
      delete current[id];
      await setFlagged(current);
      render();
    });
    tdU.appendChild(btn);
    tr.appendChild(tdU);

    tbody.appendChild(tr);
  }
}

// Sort on header click
document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'flaggedAt' || col === 'amount' ? 'desc' : 'asc';
    }
    render();
  });
});

// Clear all
document.getElementById('clear-all-btn').addEventListener('click', async () => {
  if (!confirm('Remove all flags?')) return;
  await setFlagged({});
  render();
});

render();
