import asyncio
import websockets
import json
import base64
import cv2
import numpy as np

async def test():
    # Create a dummy image
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    _, buffer = cv2.imencode('.jpg', img)
    b64 = base64.b64encode(buffer).decode('utf-8')
    frame_data = f"data:image/jpeg;base64,{b64}"
    
    try:
        # Get active session
        import urllib.request
        req = urllib.request.urlopen("http://localhost:8000/api/sessions/")
        sessions = json.loads(req.read())
        active = [s for s in sessions if s['is_active']]
        if not active:
            print("No active session found")
            return
        session_id = active[0]['id']
        
        uri = f"ws://localhost:8000/ws/monitoring/{session_id}/"
        async with websockets.connect(uri) as ws:
            print("Connected to WebSocket")
            await ws.send(json.dumps({"frame": frame_data}))
            print("Sent frame")
            res = await ws.recv()
            print("Received:", res[:200])
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
