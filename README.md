# Xero Flagger

A Chrome extension that adds flagging functionality to Xero's accounts payable views.

## Features

- **Flag button** — appears on every payable invoice detail page. Red by default; cycles through bright rainbow colours when active.
- **Remove Flagged button** — appears on the *Awaiting Payment* bill list. Clears flags for invoices that are no longer present in the list and shows a success/warning indicator.
- Flagged invoice rows are highlighted in the Awaiting Payment list so they stand out at a glance.

## Installation (Chrome)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `Xero-Flagger` folder.
5. Navigate to `go.xero.com` — the extension activates automatically.

## How it works

| Page | What appears |
|------|-------------|
| `AccountsPayable/View.aspx?InvoiceID=…` | Red **Flag** button near the top of the page. Click to toggle; it animates with rainbow colours when flagged. |
| `…/bills/list/awaiting-payment` | Orange **Remove Flagged** bar at the top of the list. Click the button to clear flags for any invoice that no longer appears in the list. A ✓ or ⚠ status message is shown inline. |

Flag state is persisted in `chrome.storage.local` so it survives page reloads and browser restarts.
