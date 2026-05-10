from django.test import TestCase
from core.ai_engine import SurveillanceAI
from unittest.mock import patch, MagicMock
import numpy as np

class VideoPipelineTests(TestCase):
    def setUp(self):
        self.ai = SurveillanceAI()
        self.ai.known_face_names = ["CS101"]
        self.ai.known_face_encodings = [np.array([0.1]*128)]

    @patch('face_recognition.face_locations')
    @patch('face_recognition.face_encodings')
    def test_pipeline_integration(self, mock_enc, mock_loc):
        # Create a dummy base64 string for cv2 to decode successfully
        # Just a 1x1 black image in base64:
        import base64
        import cv2
        dummy_img = np.zeros((10, 10, 3), dtype=np.uint8)
        _, buffer = cv2.imencode('.jpg', dummy_img)
        b64_str = base64.b64encode(buffer).decode('utf-8')
        frame_data = "data:image/jpeg;base64," + b64_str

        # Frame 1: Face Missing (Mocking empty detections)
        mock_loc.return_value = []
        mock_enc.return_value = []
        
        # We also need to mock face_mesh.process and pose.process inside ai_engine
        self.ai.face_mesh.process = MagicMock(return_value=MagicMock(multi_face_landmarks=None))
        self.ai.yolo_model = MagicMock(return_value=[MagicMock(boxes=[])])
        
        # Test missing face threshold (10 frames)
        for _ in range(10):
            detections, alerts, _ = self.ai.process_frame(frame_data, session_id=1)
            
        self.assertTrue(any(a['type'] == 'face_missing' for a in alerts))
