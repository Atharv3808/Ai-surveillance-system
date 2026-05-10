from django.test import TestCase
from core.ai_engine import SurveillanceAI
import numpy as np
import time

class FaceRecognitionTests(TestCase):
    def setUp(self):
        self.ai = SurveillanceAI()

    def test_match_face_with_persistence(self):
        # Setup mock known encodings
        self.ai.known_face_encodings = [np.array([0.1]*128)]
        self.ai.known_face_names = ["CS101"]

        # Exact match
        current_time = time.time()
        name, conf = self.ai.match_face_with_persistence(
            np.array([0.1]*128),
            (10, 50, 50, 10),
            [(10, 50, 50, 10)],
            current_time
        )
        self.assertEqual(name, "CS101")
        self.assertGreater(conf, 0.9)

        # Unknown match
        name, conf = self.ai.match_face_with_persistence(
            np.array([0.9]*128),
            (10, 50, 50, 10),
            [(10, 50, 50, 10)],
            current_time
        )
        self.assertEqual(name, "Unknown")
