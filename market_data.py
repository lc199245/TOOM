"""Market data fetching via yfinance."""

import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed


def get_quote(ticker: str) -> dict | None:
    """Fetch current quote data for a single ticker."""
    try:
        t = yf.Ticker(ticker)
        info = t.fast_info

        # Get today's and previous close data
        hist = t.history(period="5d")
        if hist.empty:
            return None

        current_price = hist["Close"].iloc[-1]

        # Previous close
        if len(hist) >= 2:
            prev_close = hist["Close"].iloc[-2]
        else:
            prev_close = current_price

        change = current_price - prev_close
        change_pct = (change / prev_close) * 100 if prev_close else 0

        # Try to get name + fundamental data + extended hours
        name = ticker
        long_name = None
        week52_high = None
        week52_low = None
        pe_ratio = None
        pre_market_price = None
        pre_market_change = None
        pre_market_change_pct = None
        post_market_price = None
        post_market_change = None
        post_market_change_pct = None
        try:
            info = t.info
            name = info.get("shortName", ticker)
            long_name = info.get("longName") or name
            week52_high = info.get("fiftyTwoWeekHigh")
            week52_low = info.get("fiftyTwoWeekLow")
            pe_ratio = info.get("trailingPE") or info.get("forwardPE")

            # Pre-market data
            pm_price = info.get("preMarketPrice")
            if pm_price and pm_price > 0:
                pre_market_price = round(pm_price, 2)
                pre_market_change = round(pm_price - current_price, 2)
                pre_market_change_pct = round(((pm_price - current_price) / current_price) * 100, 2)

            # Post-market (after hours) data
            ah_price = info.get("postMarketPrice")
            if ah_price and ah_price > 0:
                post_market_price = round(ah_price, 2)
                post_market_change = round(ah_price - current_price, 2)
                post_market_change_pct = round(((ah_price - current_price) / current_price) * 100, 2)
        except Exception:
            pass

        return {
            "ticker": ticker.upper(),
            "name": name,
            "long_name": long_name or name,
            "price": round(current_price, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "prev_close": round(prev_close, 2),
            "high": round(hist["High"].iloc[-1], 2),
            "low": round(hist["Low"].iloc[-1], 2),
            "volume": int(hist["Volume"].iloc[-1]) if "Volume" in hist else 0,
            "week52_high": round(week52_high, 2) if week52_high else None,
            "week52_low": round(week52_low, 2) if week52_low else None,
            "pe_ratio": round(pe_ratio, 2) if pe_ratio else None,
            "pre_market_price": pre_market_price,
            "pre_market_change": pre_market_change,
            "pre_market_change_pct": pre_market_change_pct,
            "post_market_price": post_market_price,
            "post_market_change": post_market_change,
            "post_market_change_pct": post_market_change_pct,
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    except Exception as e:
        print(f"  Error fetching {ticker}: {e}")
        return None


def get_bulk_quotes(tickers: list[str], max_workers: int = 8) -> dict[str, dict]:
    """Fetch quotes for multiple tickers concurrently."""
    results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(get_quote, t): t for t in tickers}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                data = future.result()
                if data:
                    results[ticker.upper()] = data
            except Exception:
                pass
    return results


def get_chart_data(ticker: str, period: str = "1mo", interval: str = "1d") -> list[dict]:
    """
    Fetch OHLCV data for charting.

    Args:
        ticker: Stock/ETF ticker.
        period: yfinance period string (1d, 5d, 1mo, 3mo, 6mo, 1y, 5y, max).
        interval: yfinance interval (1m, 5m, 15m, 1h, 1d, 1wk, 1mo).
    """
    try:
        t = yf.Ticker(ticker)
        # Include pre/post market data for intraday intervals
        include_prepost = interval in ("1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h")

        # yfinance doesn't support '10y' — use start/end dates instead
        if period == "10y":
            start = (datetime.now() - timedelta(days=365 * 10)).strftime("%Y-%m-%d")
            hist = t.history(start=start, interval=interval, prepost=include_prepost)
        else:
            hist = t.history(period=period, interval=interval, prepost=include_prepost)
        if hist.empty:
            return []

        data = []
        for idx, row in hist.iterrows():
            ts = int(idx.timestamp())
            data.append({
                "time": ts,
                "open": round(row["Open"], 2),
                "high": round(row["High"], 2),
                "low": round(row["Low"], 2),
                "close": round(row["Close"], 2),
                "volume": int(row["Volume"]) if "Volume" in row else 0,
            })
        return data
    except Exception as e:
        print(f"  Error fetching chart data for {ticker}: {e}")
        return []


def search_tickers(query: str) -> list[dict]:
    """Search for tickers matching a query string."""
    try:
        results = []
        # Use yfinance search
        search = yf.Search(query, max_results=10)
        if hasattr(search, "quotes") and search.quotes:
            for item in search.quotes:
                results.append({
                    "ticker": item.get("symbol", ""),
                    "name": item.get("shortname", item.get("longname", "")),
                    "long_name": item.get("longname", item.get("shortname", "")),
                    "exchange": item.get("exchange", ""),
                    "type": item.get("quoteType", ""),
                })
        return results
    except Exception as e:
        print(f"  Search error: {e}")
        return []
