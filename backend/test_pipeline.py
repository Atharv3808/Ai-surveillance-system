import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'surveillance_backend.settings')
django.setup()

import cv2
import numpy as np
import base64
from core.ai_engine import SurveillanceAI

def test():
    ai = SurveillanceAI()
    ai.load_known_faces()
    print("Loaded known faces:", ai.known_face_names)
    
    # Create a dummy valid image (a white square)
    img = np.ones((480, 640, 3), dtype=np.uint8) * 255
    # Put a face-like structure so face_recognition might not crash, or just use plain image
    
    _, buffer = cv2.imencode('.jpg', img)
    b64 = base64.b64encode(buffer).decode('utf-8')
    frame_data = f"data:image/jpeg;base64,{b64}"
    
    print("Processing frame...")
    dets, alerts, frame = ai.process_frame(frame_data, session_id=1)
    print("Detections:", dets)
    print("Alerts:", alerts)

test()
