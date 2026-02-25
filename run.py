"""Entry point — run the Live Market Dashboard."""

import uvicorn

if __name__ == "__main__":
    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║       Live Market Dashboard              ║")
    print("  ║       http://localhost:8050               ║")
    print("  ╚══════════════════════════════════════════╝")
    print()

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8050,
        reload=True,
    )
