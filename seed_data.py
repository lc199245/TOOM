"""Default watchlist data — seeded on first run when the database is empty."""

DEFAULT_TABS = [
    {"name": "Main", "sort_order": 0},
    {"name": "MAG7", "sort_order": 1},
    {"name": "AA", "sort_order": 2},
    {"name": "US Sectors", "sort_order": 3},
]

DEFAULT_WATCHLIST = {
    "Main": [
        ("AEM", "Agnico Eagle Mines"),
        ("TLT", "20+ Year Treasury ETF"),
        ("VTI", "Total Stock Market ETF"),
        ("FSAGX", "Fidelity Gold Fund"),
    ],
    "MAG7": [
        ("AAPL", "Apple Inc."),
        ("AMZN", "Amazon.com Inc."),
        ("GOOG", "Alphabet Inc."),
        ("META", "Meta Platforms Inc."),
        ("TSLA", "Tesla Inc."),
        ("MSFT", "Microsoft Corporation"),
        ("NVDA", "NVIDIA Corporation"),
        ("MAGS", "Roundhill Magnificent Seven ETF"),
    ],
    "AA": [
        ("ACWI", "iShares MSCI ACWI ETF"),
        ("EFA", "iShares MSCI EAFE ETF"),
        ("EEM", "iShares MSCI Emerging Markets ETF"),
        ("BCOM.XA", "Bloomberg Commodity Index"),
        ("GLD", "SPDR Gold Shares"),
        ("SLV", "iShares Silver Trust"),
        ("SPY", "SPDR S&P 500 ETF"),
        ("IWM", "iShares Russell 2000 ETF"),
    ],
    "US Sectors": [
        ("XLK", "Technology"),
        ("XLF", "Financials"),
        ("XLV", "Health Care"),
        ("XLY", "Consumer Discretionary"),
        ("XLC", "Communication Services"),
        ("XLI", "Industrials"),
        ("XLP", "Consumer Staples"),
        ("XLE", "Energy"),
        ("XLU", "Utilities"),
        ("XLRE", "Real Estate"),
        ("XLB", "Materials"),
    ],
}
