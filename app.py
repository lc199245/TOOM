"""FastAPI application — serves dashboard + API endpoints."""

import os
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from database import (
    init_db, get_tabs, create_tab, rename_tab, delete_tab,
    get_watchlist, add_ticker, remove_ticker, reorder_watchlist,
)
from market_data import get_bulk_quotes, get_chart_data, search_tickers

# ── App setup ──────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="The One and Only Monitor")

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# Init DB on startup
init_db()


# ── Request models ─────────────────────────────────────────────────────────

class TabBody(BaseModel):
    name: str

class ReorderBody(BaseModel):
    tickers: list[str]


# ── Pages ──────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, tab: int = 0):
    """Render the main dashboard page."""
    tabs = get_tabs()
    if not tabs:
        init_db()
        tabs = get_tabs()

    # Determine active tab
    if tab > 0:
        active_tab_id = tab
    else:
        active_tab_id = tabs[0]["id"]

    # Ensure the requested tab exists
    active_tab = next((t for t in tabs if t["id"] == active_tab_id), tabs[0])
    active_tab_id = active_tab["id"]

    watchlist = get_watchlist(active_tab_id)
    tickers = [w["ticker"] for w in watchlist]
    quotes = get_bulk_quotes(tickers) if tickers else {}

    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "tabs": tabs,
        "active_tab_id": active_tab_id,
        "watchlist": watchlist,
        "quotes": quotes,
    })


# ── API: Tabs ──────────────────────────────────────────────────────────────

@app.get("/api/tabs")
async def api_get_tabs():
    return JSONResponse(content=get_tabs())


@app.post("/api/tabs")
async def api_create_tab(body: TabBody):
    tab = create_tab(body.name)
    return JSONResponse(content=tab)


@app.put("/api/tabs/{tab_id}")
async def api_rename_tab(tab_id: int, body: TabBody):
    success = rename_tab(tab_id, body.name)
    if success:
        return JSONResponse(content={"status": "renamed", "id": tab_id, "name": body.name})
    return JSONResponse(content={"status": "not_found"}, status_code=404)


@app.delete("/api/tabs/{tab_id}")
async def api_delete_tab(tab_id: int):
    success = delete_tab(tab_id)
    if success:
        return JSONResponse(content={"status": "deleted", "id": tab_id})
    return JSONResponse(
        content={"status": "failed", "message": "Cannot delete the last tab"},
        status_code=400,
    )


# ── API: Quotes ────────────────────────────────────────────────────────────

@app.get("/api/quotes")
async def api_quotes(tab_id: int = 0):
    if tab_id == 0:
        tabs = get_tabs()
        tab_id = tabs[0]["id"] if tabs else 0
    watchlist = get_watchlist(tab_id)
    tickers = [w["ticker"] for w in watchlist]
    quotes = get_bulk_quotes(tickers) if tickers else {}
    return JSONResponse(content=quotes)


@app.get("/api/quote/{ticker}")
async def api_single_quote(ticker: str):
    quotes = get_bulk_quotes([ticker.upper()])
    if ticker.upper() in quotes:
        return JSONResponse(content=quotes[ticker.upper()])
    return JSONResponse(content={"error": "Ticker not found"}, status_code=404)


# ── API: Chart data ───────────────────────────────────────────────────────

@app.get("/api/chart/{ticker}")
async def api_chart(ticker: str, period: str = "1mo", interval: str = "1d"):
    data = get_chart_data(ticker.upper(), period=period, interval=interval)
    return JSONResponse(content=data)


# ── API: Search ────────────────────────────────────────────────────────────

@app.get("/api/search")
async def api_search(q: str = ""):
    if len(q) < 1:
        return JSONResponse(content=[])
    results = search_tickers(q)
    return JSONResponse(content=results)


# ── API: Watchlist CRUD (tab-scoped) ──────────────────────────────────────

@app.get("/api/watchlist/{tab_id}")
async def api_get_watchlist(tab_id: int):
    return JSONResponse(content=get_watchlist(tab_id))


@app.post("/api/watchlist/{tab_id}/{ticker}")
async def api_add_to_watchlist(tab_id: int, ticker: str, name: str = ""):
    success = add_ticker(tab_id, ticker.upper(), name)
    if success:
        return JSONResponse(content={"status": "added", "ticker": ticker.upper()})
    return JSONResponse(
        content={"status": "exists", "message": f"{ticker.upper()} already in this list"},
        status_code=409,
    )


@app.put("/api/watchlist/{tab_id}/reorder")
async def api_reorder_watchlist(tab_id: int, body: ReorderBody):
    success = reorder_watchlist(tab_id, body.tickers)
    if success:
        return JSONResponse(content={"status": "reordered", "tab_id": tab_id})
    return JSONResponse(content={"status": "failed"}, status_code=400)


@app.delete("/api/watchlist/{tab_id}/{ticker}")
async def api_remove_from_watchlist(tab_id: int, ticker: str):
    success = remove_ticker(tab_id, ticker.upper())
    if success:
        return JSONResponse(content={"status": "removed", "ticker": ticker.upper()})
    return JSONResponse(
        content={"status": "not_found", "message": f"{ticker.upper()} not in this list"},
        status_code=404,
    )
