import asyncio
import os

from extract_data import extract_orderepi
from playwright.async_api import async_playwright

async def main():
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                if line.strip() and not line.startswith("#"):
                    key, value = line.strip().split("=", 1)
                    os.environ[key] = value

    print("ORDER_EPI_ID:", os.environ.get("ORDER_EPI_ID"))
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            await extract_orderepi(browser)
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
