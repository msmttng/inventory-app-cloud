import requests
import os

def test_epi():
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    
    # 1. Get initial cookie and session ID
    url1 = "https://www.order-epi.com/order/"
    res1 = session.get(url1)
    
    # Extract session ID from URL or form if any
    
    # 2. Post Login
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
    res2 = session.post(login_url, data=payload, allow_redirects=True)
    print("Post status:", res2.status_code)
    
    # 3. Check cookies
    print("Cookies:", session.cookies.get_dict())
    
    # 4. Try getting history
    res3 = session.get("https://www.order-epi.com/order/servlet/InvokerServlet?s2=OrderHistoryList")
    print("Hist status:", len(res3.text))
    if "発注履歴" in res3.text:
       print("HISTORY FOUND")
    else:
       import re
       title = re.search(r'<TITLE>(.*?)</TITLE>', res3.text, re.IGNORECASE)
       print("Title found:", title.group(1) if title else "No title")

test_epi()
