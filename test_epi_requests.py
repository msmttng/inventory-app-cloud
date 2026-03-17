import requests
import os
import bs4

def test_epi_post():
    session = requests.Session()
    # 1. Get login page to get session cookie
    url = "https://www.order-epi.com/order/"
    res_get = session.get(url)
    
    # 2. Login
    login_url = "https://www.order-epi.com/order/servlet/InvokerServlet?s2=LoginCheck"
    payload = {
        "USER_ID": os.environ.get("ORDER_EPI_ID", "000877242"),
        "PASSWD": os.environ.get("ORDER_EPI_PASSWORD", "m1m1m1m1"),
        "USE_COOKIE_LOGIN": "",
        "USE_PASSWORD_WINDOW": "",
        "MODELKBN": "3",
        "RENEWALFLG": "1",
        "SESSION_ID": ""
    }
    
    res_post = session.post(login_url, data=payload)
    print("Login Post Status:", res_post.status_code)
    
    # Check if login was successful by trying to get history page
    hist_url = "https://www.order-epi.com/order/servlet/InvokerServlet?s2=OrderHistoryList"
    res_hist = session.get(hist_url)
    print("History GET Status:", res_hist.status_code)
    
    soup = bs4.BeautifulSoup(res_hist.text, "html.parser")
    tables = soup.find_all("table")
    print(f"Found {len(tables)} tables on history page")
    
    # Let's see if we see "発注履歴" in text
    if "発注履歴" in res_hist.text:
        print("Successfully accessed history page!")
        
        # Let's count rows in the main data table
        for table in tables:
            rows = table.find_all("tr")
            if len(rows) > 2:
                for r in rows:
                    cols = r.find_all("td")
                    if len(cols) >= 7:
                        maker = cols[2].text.strip().replace('\n', '')
                        name = cols[3].text.strip().replace('\n', '')
                        qty = cols[4].text.strip().replace('\n', '')
                        date_str = cols[6].text.strip().replace('\n', '')
                        print(f"  Row: {date_str} / {maker} / {name} / Qty: {qty}")
                break

test_epi_post()
