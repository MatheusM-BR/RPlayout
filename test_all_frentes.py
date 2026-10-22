import asyncio
import json
import os
import subprocess
import time
import urllib.request
import websockets

SCREENSHOTS_DIR = r"C:\Users\fsda\.gemini\antigravity\brain\3f37213a-1d71-442c-9003-9c1330132969"
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
USER_DATA_DIR = os.path.join(SCREENSHOTS_DIR, "edge_test_frentes_v3")

async def run_verification():
    print("Launching Edge headless with remote debugging on port 9223...")
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
        print(f"Connected to CDP page: {ws_url}")

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
            
            # Dismiss first-run if present
            await eval_js("""
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Entendi'));
                if (btn) btn.click();
            """)
            await asyncio.sleep(1)

            # Explicitly navigate to http://127.0.0.1:4000
            await send_cmd("Page.navigate", {"url": "http://127.0.0.1:4000"})
            await asyncio.sleep(3)

            print("=== FRENTE 1: VERIFICAR SAÍDAS EM CONFIGURAÇÕES ===")
            # Click on Settings button in header
            await eval_js("""
                const btn = document.querySelector('button[title="Configurações e Canais"]');
                if (btn) btn.click();
            """)
            await asyncio.sleep(1.5)

            # Click on 'Saídas de Transmissão' sub-tab
            await eval_js("""
                const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Saídas'));
                if (tab) tab.click();
            """)
            await asyncio.sleep(1.5)
            await capture_screen("frente1_settings_saidas")

            saidas_check = await eval_js("""
                (() => {
                    const text = document.body.innerText;
                    return {
                        hasDecklink: text.includes('DeckLink') || text.includes('SDI'),
                        hasNDI: text.includes('NDI'),
                        hasSRT: text.includes('SRT'),
                        hasRTMP: text.includes('RTMP'),
                        hasNovaSaida: text.includes('NOVA SAÍDA DE TRANSMISSÃO'),
                        hasOldModal: document.querySelector('.distribution-dialog') !== null
                    };
                })()
            """)
            print("Saidas check:", saidas_check)

            print("=== FRENTE 2: VERIFICAR QUALITY CONTROL (QC) ===")
            # Click QC in header nav
            await eval_js("""
                const qcBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.trim() === 'QC');
                if (qcBtn) qcBtn.click();
            """)
            await asyncio.sleep(2)
            await capture_screen("frente2_qc_workspace")

            qc_check = await eval_js("""
                (() => {
                    const text = document.body.innerText;
                    const items = document.querySelectorAll('button');
                    return {
                        hasMAMList: text.includes('ACERVO MAM') || text.includes('FILTROS & PESQUISA') || text.includes('VÍDEOS'),
                        hasAprovar: text.includes('APROVAR QC') || text.includes('Aprovar'),
                        hasScopes: text.includes('Vectorscope') || text.includes('Waveform'),
                        hasPlayer: text.includes('PLAYER & CONFORMIDADE QC') || text.includes('PLAYER')
                    };
                })()
            """)
            print("QC check:", qc_check)

            print("=== FRENTE 3: VERIFICAR AIRED COM ROLAGEM ===")
            # Click Aired in header nav
            await eval_js("""
                const airedBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.trim() === 'Aired');
                if (airedBtn) airedBtn.click();
            """)
            await asyncio.sleep(2)
            await capture_screen("frente3_aired_workspace")

            aired_scroll_check = await eval_js("""
                (() => {
                    const scrollContainer = document.querySelector('.broadcast-scroll');
                    if (!scrollContainer) return { found: false };
                    const initialScroll = scrollContainer.scrollTop;
                    scrollContainer.scrollTop = 400;
                    const scrolled = scrollContainer.scrollTop;
                    return {
                        found: true,
                        scrollHeight: scrollContainer.scrollHeight,
                        clientHeight: scrollContainer.clientHeight,
                        canScroll: scrollContainer.scrollHeight > scrollContainer.clientHeight,
                        scrolledAmount: scrolled
                    };
                })()
            """)
            print("AIRED scroll check:", aired_scroll_check)

            print("=== FRENTE 4: VERIFICAR AUTOFILL VIA GAP CLICK ===")
            # Switch back to Playlist in header nav
            await eval_js("""
                const plBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent && b.textContent.trim() === 'Playlist');
                if (plBtn) plBtn.click();
            """)
            await asyncio.sleep(2)

            # Click GAP indicator or Auto-Fill button
            await eval_js("""
                const gapBtn = Array.from(document.querySelectorAll('div, button')).find(el => el.textContent && el.textContent.includes('GAPS DETECTADOS'));
                if (gapBtn) {
                    gapBtn.click();
                } else {
                    const afBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Auto-Fill Gaps'));
                    if (afBtn) afBtn.click();
                }
            """)
            await asyncio.sleep(2)
            await capture_screen("frente4_autofill_dialog")

            autofill_check = await eval_js("""
                (() => {
                    const text = document.body.innerText;
                    const inputs = Array.from(document.querySelectorAll('input'));
                    return {
                        hasDialog: text.includes('Assistente de AutoFill'),
                        hasHoursMinutes: text.includes('Horas') && text.includes('Minutos'),
                        hasRangeMode: text.includes('Por Intervalo'),
                        inputsFound: inputs.length
                    };
                })()
            """)
            print("AutoFill check:", autofill_check)

            # Close autofill dialog
            await eval_js("""
                const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Cancelar');
                if (closeBtn) closeBtn.click();
            """)
            await asyncio.sleep(1)

            print("=== FRENTE 5: VERIFICAR MULTISSELEÇÃO NA PLAYLIST ===")
            multiselect_check = await eval_js("""
                (() => {
                    const rows = document.querySelectorAll('[id^="row-"]');
                    if (rows.length < 2) return { rowsCount: rows.length, success: false };
                    
                    // Click first row
                    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    
                    // Shift click second row (or third)
                    const targetIdx = Math.min(2, rows.length - 1);
                    rows[targetIdx].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
                    
                    const bar = document.body.innerText.includes('MULTISSELEÇÃO ATIVA');
                    const match = document.body.innerText.match(/(\\d+) itens selecionados/);
                    
                    return {
                        rowsCount: rows.length,
                        hasMultiselectBar: bar,
                        matchCount: match ? match[1] : null
                    };
                })()
            """)
            print("Multiselect check:", multiselect_check)
            await capture_screen("frente5_playlist_multiselect")

            print("All verification steps completed successfully!")

    finally:
        proc.kill()

if __name__ == "__main__":
    asyncio.run(run_verification())
