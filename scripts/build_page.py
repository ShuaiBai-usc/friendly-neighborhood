"""Assemble the self-contained landing page: src/landing.html + src/sim.js + data/build/landing-data.json -> index.html
Run: python3 scripts/build_data.py && python3 scripts/build_page.py
"""
import json
tpl = open("src/landing.html").read()
sim = open("src/sim.js").read()
data = json.load(open("data/build/landing-data.json"))
import base64
hero = "data:image/jpeg;base64," + base64.b64encode(open("assets/hero.jpg", "rb").read()).decode()
out = tpl.replace("/*__HERO__*/", hero).replace("/*__SIM__*/", sim).replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":")))
open("index.html", "w").write(out)
print(f"index.html {len(out)//1024} KB")
