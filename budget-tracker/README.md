# Budget Tracker

A single-page app that tells you what to do with each paycheck.

## What it does

- **Two budget modes.** *General budget* splits each check into bills, savings and spending (quick presets like 50/30/20, or fine-tune with sliders) and leaves the credit card out of it. *Card payoff* sends everything left after bills to an optional emergency buffer, then the credit card, until it's paid off, then switches to the normal split. Switch any time in Setup; first-time setup asks which to use.
- **Paycheck plan.** For each check (default: the 15th and the last day of the month), it lists the bills due before the next payday, then what to move to savings (and buffer/card in payoff mode) and what's left to spend. Confirm the amount when the check lands and tick off each move.
- **Spending with categories.** Log purchases with a category (ten presets, plus your own). *Where it went* breaks spending down by pay period or month, warns near and over per-category limits, compares to the last period, and shows the last six periods.
- **Extra income.** Log bonuses, side money or refunds and choose to spend it, save it, or (in payoff mode) put it on the card.
- **Savings goals.** Named goals with progress bars, funded from savings you have or new money.
- **Your data.** Export spending and income to a CSV spreadsheet, back everything up to a file, and restore it on this or another device.
- **Built-in help.** Tap any **?** for a plain-language explanation. A short intro shows on first visit, and the **?** in the header opens the full guide.

## Running it

Open `index.html` in a browser. No build step and no dependencies beyond Google Fonts.

When opened as a Claude artifact, data is saved to the artifact's database and syncs across devices. Opened anywhere else (like the Netlify site), it saves to that browser on that device and starts empty, so each person sets up their own budget on their own phone. Use Back up now and then, especially before switching phones.

No financial data is stored in this file.
