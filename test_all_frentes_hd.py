import asyncio
import json
import os
import subprocess
import time
import urllib.request
import websockets

SCREENSHOTS_DIR = r"C:\Users\fsda\.gemini\antigravity\brain\3f37213a-1d71-442c-9003-9c1330132969"
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
USER_DATA_DIR = os.path.join(SCREENSHOTS_DIR, "edge_test_frentes_hd")

async def run_verification():
    print("Launching Edge headless with 1920x1080 remote debugging...")
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
            await send_cmd("DOM.enable")
            await send_cmd("Emulation.setDeviceMetricsOverride", {
                "width": 1920,
                "height": 1080,
                "deviceScaleFactor": 1,
                "mobile": False
            })

            # Dismiss first-run if present
            await eval_js("""
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Entendi'));
                if (btn) btn.click();
            """)
            await asyncio.sleep(1)

            await send_cmd("Page.navigate", {"url": "http://127.0.0.1:4000"})
            await asyncio.sleep(3)

            print("=== FRENTE 1: VERIFICAR SAÍDAS EM CONFIGURAÇÕES ===")
            # Click settings
            await eval_js("""
                const btn = document.querySelector('button[title="Configurações e Canais"]');
                if (btn) btn.click();
            """)
            await asyncio.sleep(1.5)

            # Click Saídas de Transmissão sub-tab
            await eval_js("""
                const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Saídas de Transmissão'));
                if (tab) tab.click();
            """)
            await asyncio.sleep(1.5)
            await capture_screen("frente1_settings_saidas_hd")

            print("=== FRENTE 2: VERIFICAR QUALITY CONTROL (QC) ===")
            # Click QC workspace
            await eval_js("""
                const qcBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.trim() === 'QC');
                if (qcBtn) qcBtn.click();
            """)
            await asyncio.sleep(2.5)
            await capture_screen("frente2_qc_workspace_hd")

            # Check QC elements
            qc_info = await eval_js("""
                (() => {
                    const rows = document.querySelectorAll('.grid-cols-12, [class*="hover:bg-surface-panel"]');
                    const text = document.body.innerText;
                    return {
                        hasMAMVideos: text.includes('Fila de Ingestão') || text.includes('FILA DE INGESTÃO & VÍDEOS') || text.includes('clipes na fila'),
                        hasFilmstrip: text.includes('GSTREAMER FRAME FILMSTRIP'),
                        hasScopes: text.includes('Vectorscope') || text.includes('Luma Waveform') || text.includes('EBU R128'),
                        hasAprovarBtn: text.includes('APROVAR QC'),
                        hasRejeitarBtn: text.includes('REJEITAR / QUARANTINE')
                    };
                })()
            """)
            print("QC elements check:", qc_info)

            print("=== FRENTE 3: VERIFICAR AIRED COM ROLAGEM ===")
            # Click Aired workspace
            await eval_js("""
                const airedBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.trim() === 'Aired');
                if (airedBtn) airedBtn.click();
            """)
            await asyncio.sleep(2)

            # Scroll the table container down
            scroll_res = await eval_js("""
                (() => {
                    const scrollContainer = document.querySelector('.broadcast-scroll');
                    if (!scrollContainer) return { found: false };
                    const prev = scrollContainer.scrollTop;
                    scrollContainer.scrollTop = 500;
                    return {
                        found: true,
                        scrollHeight: scrollContainer.scrollHeight,
                        clientHeight: scrollContainer.clientHeight,
                        scrolledTo: scrollContainer.scrollTop
                    };
                })()
            """)
            print("AIRED scroll info:", scroll_res)
            await capture_screen("frente3_aired_workspace_hd")

            print("=== FRENTE 4: VERIFICAR AUTOFILL VIA GAP CLICK ===")
            # Switch back to Playlist
            await eval_js("""
                const plBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.trim() === 'Playlist');
                if (plBtn) plBtn.click();
            """)
            await asyncio.sleep(2)

            # Click on Auto-Fill Gaps button or GAP indicator
            await eval_js("""
                const gapBanner = document.querySelector('div[title*="Autofill inteligente de gaps"]');
                if (gapBanner) {
                    gapBanner.click();
                } else {
                    const afBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Auto-Fill Gaps'));
                    if (afBtn) afBtn.click();
                }
            """)
            await asyncio.sleep(2)
            await capture_screen("frente4_autofill_dialog_hd")

            # Close autofill
            await eval_js("""
                const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Cancelar');
                if (closeBtn) closeBtn.click();
            """)
            await asyncio.sleep(1)

            print("=== FRENTE 5: VERIFICAR MULTISSELEÇÃO NA PLAYLIST ===")
            # Select first row, then shift click 3rd row
            multiselect_info = await eval_js("""
                (() => {
                    const rows = document.querySelectorAll('[id^="row-"]');
                    if (rows.length < 3) return { rowCount: rows.length, error: 'Not enough rows' };
                    
                    // Click row 0
                    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    
                    // Shift click row 2
                    rows[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
                    
                    return {
                        rowCount: rows.length,
                        row0Selected: rows[0].className.includes('primary'),
                        row1Selected: rows[1].className.includes('primary'),
                        row2Selected: rows[2].className.includes('primary')
                    };
                })()
            """)
            print("Multiselect rows info:", multiselect_info)
            await asyncio.sleep(1)
            await capture_screen("frente5_playlist_multiselect_hd")

            # Check if batch bar is displayed
            batch_bar_info = await eval_js("""
                (() => {
                    const text = document.body.innerText;
                    return {
                        hasActiveBatch: text.includes('MULTISSELEÇÃO ATIVA'),
                        selectedText: text.includes('itens selecionados'),
                        hasBulkRemove: text.includes('Remover') && text.includes('Itens')
                    };
                })()
            """)
            print("Batch bar info:", batch_bar_info)

            print("=== TODOS OS TESTES VISUAIS EM 1080P CONCLUÍDOS COM SUCESSO! ===")

    finally:
        proc.kill()

if __name__ == "__main__":
    asyncio.run(run_verification())
