# Sales & Profit Performance Dashboard

An interactive, single-file HTML dashboard built for senior management to explore retail sales and profitability data.

## Overview

This dashboard analyzes the Superstore dataset (9,994 transactions, 2014-2017) and surfaces key sales and profitability insights through interactive visualizations. Everything runs client-side in a single HTML file - no server, no build tools, no dependencies to install.

## Features

- 6 KPI Cards with sparklines and comparison deltas
- 5 Interactive Charts (trend, segment donut, regional bars, discount bubble, sub-category performance)
- Comparison Toggle (Last Week, Last 4 Weeks, Last Year)
- 8 Cross-Filters that update all charts and KPIs simultaneously
- Auto-Generated Insights Panel
- Sortable Performance Table
- Dark/Light Theme Toggle

## Getting Started

1. Download or clone this repo
2. Open index.html in any modern browser
3. The dashboard loads instantly - data is embedded in the file

No npm install, no server, no API keys required.

## Technical Details

- Single file: All HTML, CSS, JS, Chart.js library, and data are inline
- Data compression: 3 MB raw JSON compressed to 763 KB using columnar encoding
- Async loading: Data decoding via requestAnimationFrame
- Responsive: CSS Grid layout adapts from desktop to mobile
- Accessible: WCAG-informed color palette with contrast ratios in both themes

## Built With

- Chart.js 4.4.4 (inlined)
- Vanilla HTML/CSS/JS

## License

MIT
