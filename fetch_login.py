import requests

def get_login_form():
    url = "https://www.order-epi.com/order/"
    res = requests.get(url)
    print("STATUS", res.status_code)
    
    # Save the HTML to check the forms
    with open("epi_login.html", "w", encoding="utf-8") as f:
        f.write(res.text)

get_login_form()
