import asyncio
import json
import os
import subprocess
import time
import urllib.request
import websockets

SCREENSHOTS_DIR = r"C:\Users\fsda\.gemini\antigravity\brain\3f37213a-1d71-442c-9003-9c1330132969"
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
USER_DATA_DIR = os.path.join(SCREENSHOTS_DIR, "edge_test_gap_hd")

async def run():
    proc = subprocess.Popen([
        EDGE_PATH,
        "--headless=new",
        "--remote-debugging-port=9223",
        f"--user-data-dir={USER_DATA_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-search-engine-choice-screen",
        "--window-size=1920,1080",
        "http://127.0.0.1:4000"
    ])

    try:
        await asyncio.sleep(2)
        res = urllib.request.urlopen("http://127.0.0.1:9223/json").read()
        tabs = json.loads(res.decode())
        page_tab = [t for t in tabs if t.get("type") == "page"][0]
        ws_url = page_tab["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
            msg_id = 0
            async def send_cmd(method, params=None):
                nonlocal msg_id
                msg_id += 1
                payload = {"id": msg_id, "method": method, "params": params or {}}
                await ws.send(json.dumps(payload))
                while True:
                    resp = await ws.recv()
                    data = json.loads(resp)
                    if data.get("id") == msg_id:
                        return data.get("result", {})

            async def eval_js(expr):
                r = await send_cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                return r.get("result", {}).get("value")

            async def capture_screen(name):
                r = await send_cmd("Page.captureScreenshot", {"format": "png"})
                path = os.path.join(SCREENSHOTS_DIR, f"{name}.png")
                with open(path, "wb") as f:
                    import base64
                    f.write(base64.b64decode(r["data"]))
                print(f"Captured screenshot: {path}")

            await send_cmd("Page.enable")
            await send_cmd("Emulation.setDeviceMetricsOverride", {
                "width": 1920,
                "height": 1080,
                "deviceScaleFactor": 1,
                "mobile": False
            })

            # Navigate to playlist
            await send_cmd("Page.navigate", {"url": "http://127.0.0.1:4000"})
            await asyncio.sleep(3)

            # Click Playlist
            await eval_js("""
                const plBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.trim() === 'Playlist');
                if (plBtn) plBtn.click();
            """)
            await asyncio.sleep(1.5)

            # Open Auto-Fill
            await eval_js("""
                const afBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Auto-Fill Gaps'));
                if (afBtn) afBtn.click();
            """)
            await asyncio.sleep(1)

            # Click "Propor Preenchimento"
            await eval_js("""
                const propBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Propor Preenchimento'));
                if (propBtn) propBtn.click();
            """)
            await asyncio.sleep(2)
            await capture_screen("frente4_autofill_proposed_hd")

            # Click Tab "Por Intervalo (De ... Até ...)"
            await eval_js("""
                const rangeTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Por Intervalo'));
                if (rangeTab) rangeTab.click();
            """)
            await asyncio.sleep(1)
            await capture_screen("frente4_autofill_range_mode_hd")

            print("Done testing GAP autofill propose & range mode!")
    finally:
        proc.kill()

if __name__ == "__main__":
    asyncio.run(run())
