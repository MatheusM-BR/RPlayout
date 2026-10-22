import asyncio
import json
import os
import subprocess
import time
import urllib.request
import websockets

SCREENSHOTS_DIR = r"C:\Users\fsda\.gemini\antigravity\brain\3f37213a-1d71-442c-9003-9c1330132969"
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
USER_DATA_DIR = os.path.join(SCREENSHOTS_DIR, "edge_test_master_fix")

async def test_page():
    print("Launching Edge headless...")
    proc = subprocess.Popen([
        EDGE_PATH,
        "--headless=new",
        "--remote-debugging-port=9224",
        f"--user-data-dir={USER_DATA_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-search-engine-choice-screen",
        "--window-size=1920,1080",
        "about:blank"
    ])
    
    try:
        # Wait for devtools port
        ws_url = None
        for _ in range(30):
            try:
                resp = urllib.request.urlopen("http://127.0.0.1:9224/json", timeout=1)
                data = json.loads(resp.read().decode())
                if data:
                    ws_url = data[0].get("webSocketDebuggerUrl")
                    if ws_url:
                        break
            except Exception:
                pass
            time.sleep(0.3)
            
        if not ws_url:
            print("Failed to get WebSocket debugger URL")
            return
            
        async with websockets.connect(ws_url) as ws:
            msg_id = 1
            async def send_cmd(method, params=None):
                nonlocal msg_id
                cmd = {"id": msg_id, "method": method}
                if params:
                    cmd["params"] = params
                msg_id += 1
                await ws.send(json.dumps(cmd))
                while True:
                    r = json.loads(await ws.recv())
                    if r.get("id") == cmd["id"]:
                        return r

            await send_cmd("Runtime.enable")
            await send_cmd("Log.enable")
            await send_cmd("Page.enable")
            
            console_errors = []
            
            # Listen in background
            async def listener():
                while True:
                    try:
                        raw = await ws.recv()
                        ev = json.loads(raw)
                        if ev.get("method") == "Runtime.consoleAPICalled":
                            args = [str(a.get("value", a)) for a in ev["params"].get("args", [])]
                            log_type = ev["params"].get("type")
                            msg = f"[{log_type}] " + " ".join(args)
                            print("Browser Console:", msg)
                            if log_type == "error":
                                console_errors.append(msg)
                        elif ev.get("method") == "Runtime.exceptionThrown":
                            desc = ev["params"]["exceptionDetails"].get("exception", {}).get("description", "")
                            print("Browser Exception:", desc)
                            console_errors.append(desc)
                    except Exception:
                        break
                        
            listener_task = asyncio.create_task(listener())
            
            # Navigate to http://localhost:4000/?workspace=master
            print("Navigating to http://localhost:4000/?workspace=master...")
            await send_cmd("Page.navigate", {"url": "http://localhost:4000/?workspace=master"})
            
            # Wait 4 seconds for full render
            await asyncio.sleep(4)
            
            # Capture screenshot
            print("Capturing screenshot...")
            shot = await send_cmd("Page.captureScreenshot", {"format": "png"})
            import base64
            img_data = base64.b64decode(shot["result"]["data"])
            out_file = os.path.join(SCREENSHOTS_DIR, "verify_master_fix.png")
            with open(out_file, "wb") as f:
                f.write(img_data)
            print(f"Screenshot saved to {out_file} ({len(img_data)} bytes)")
            
            listener_task.cancel()
            
            if console_errors:
                print(f"Found {len(console_errors)} console errors:")
                for err in console_errors:
                    print("  -", err)
            else:
                print("SUCCESS: 0 console errors detected! Page rendered cleanly!")
                
    finally:
        proc.kill()

if __name__ == "__main__":
    asyncio.run(test_page())
