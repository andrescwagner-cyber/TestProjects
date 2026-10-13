# Paycheck Planner

A budgeting app for people paid twice a month. Enter your check, subtract your bills and spending, and see how much you have left until your next payday.

## Features

- **Twice-a-month pay.** Paydays are the 15th and the last day of the month by default. A payday that falls on a weekend moves to the Friday before.
- **Flexible paydays.** If a check lands early or late, change that one payday when you enter the check. Only that pay period moves.
- **Bills where they're due.** Each bill comes out of the check you get before it's due, at the full amount.
- **Spending log.** Log purchases by category and watch what's left drop. Category limits show "On pace", "Running hot" or "Over".
- **Savings.** Set aside a percent or a fixed amount from each check. Whatever is left when a pay period ends goes to savings.
- **Themes.** Six color themes plus light, dark and system modes.

## Use it

It's a plain static site with no build step. On Netlify, import this repo and set the base directory to `paycheck-planner`. Then open the site in Safari on your iPhone and tap Share → Add to Home Screen. It installs with its own icon, opens full screen, and works offline.

Your data is saved on that device in the app's local storage. Deleting the home-screen app or clearing Safari's website data erases it.
