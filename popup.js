const STORAGE_KEY = 'xeroFlaggedInvoices';

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

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

async function render() {
  const flagged = await getFlagged();
  const entries = Object.entries(flagged).sort((a, b) => b[1].flaggedAt - a[1].flaggedAt);

  const list = document.getElementById('invoice-list');
  const empty = document.getElementById('empty-state');
  const badge = document.getElementById('count-badge');

  list.innerHTML = '';

  if (entries.length === 0) {
    empty.classList.remove('hidden');
    badge.textContent = '';
    return;
  }

  empty.classList.add('hidden');
  badge.textContent = entries.length;

  for (const [id, inv] of entries) {
    const li = document.createElement('li');
    li.className = 'invoice-item';

    const info = document.createElement('div');
    info.className = 'invoice-info';

    const supplier = document.createElement('div');
    supplier.className = 'invoice-supplier';
    if (inv.url) {
      const a = document.createElement('a');
      a.href = inv.url;
      a.textContent = inv.label || id;
      a.target = '_blank';
      supplier.appendChild(a);
    } else {
      supplier.textContent = inv.label || id;
    }

    const meta = document.createElement('div');
    meta.className = 'invoice-meta';

    if (inv.reference) {
      const ref = document.createElement('span');
      ref.className = 'meta-ref';
      ref.textContent = inv.reference;
      meta.appendChild(ref);
    }

    if (inv.amount) {
      const amt = document.createElement('span');
      amt.className = 'meta-amount';
      amt.textContent = inv.amount;
      meta.appendChild(amt);
    }

    const date = document.createElement('span');
    date.className = 'meta-date';
    date.textContent = formatDate(inv.flaggedAt);
    meta.appendChild(date);

    info.appendChild(supplier);
    info.appendChild(meta);

    const unflagBtn = document.createElement('button');
    unflagBtn.className = 'unflag-btn';
    unflagBtn.textContent = 'Unflag';
    unflagBtn.addEventListener('click', async () => {
      const current = await getFlagged();
      delete current[id];
      await setFlagged(current);
      render();
    });

    li.appendChild(info);
    li.appendChild(unflagBtn);
    list.appendChild(li);
  }
}

render();
