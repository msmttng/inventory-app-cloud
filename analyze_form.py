import re

with open("epi_login.html", "r", encoding="utf-8") as f:
    html = f.read()

forms = re.findall(r'<form.*?</form>', html, re.DOTALL | re.IGNORECASE)
for form in forms:
    if 'USER_ID' in form:
        print("LOGIN FORM FOUND:")
        action = re.search(r'action="([^"]+)"', form)
        print("Action:", action.group(1) if action else "None")
        
        inputs = re.findall(r'<input[^>]+>', form, re.IGNORECASE)
        for inp in inputs:
            name = re.search(r'name="([^"]+)"', inp)
            val = re.search(r'value="([^"]*)"', inp)
            n = name.group(1) if name else None
            v = val.group(1) if val else ""
            if n:
                print(f"  {n}: {v}")
