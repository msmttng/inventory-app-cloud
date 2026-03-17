import asyncio
import os
from playwright.async_api import async_playwright
from extract_data import extract_orderepi

os.environ['ORDER_EPI_ID'] = '000877242'
os.environ['ORDER_EPI_PASSWORD'] = 'm1m1m1m1'

async def test_epi():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        res = await extract_orderepi(browser)
        print("Result:", res)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_epi())
