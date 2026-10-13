# Budget Tracker

A single-page app that tells you what to do with each paycheck.

## What it does

- **Paycheck plan.** For each check (default: the 15th and the last day of the month), it lists the bills due before the next payday, then tells you what to move to your buffer, credit card and savings, and what's left to spend. Confirm the amount when the check lands and tick off each move.
- **Payoff mode.** Until the buffer hits its target and the card is at $0, everything left after bills goes to the buffer first, then the card (minus an optional "keep free" amount). After that, the savings % split takes over.
- **Spending.** Log purchases as debit or credit card. Card purchases add to the card balance, and the app prompts you to send that money to the card.
- **Card.** Update the balance anytime, see buffer progress, and a check-by-check payoff schedule.
- **Setup.** Paycheck amount and paydays, split percentages, buffer target, order (buffer or card first), bills, and color theme.

## Running it

Open `index.html` in a browser. No build step and no dependencies beyond Google Fonts.

When opened as a Claude artifact, data is saved to the artifact's database and syncs across devices. Opened anywhere else, it saves to the browser's local storage on that device and starts empty, so add your paycheck and bills in Setup first.

No financial data is stored in this file.
