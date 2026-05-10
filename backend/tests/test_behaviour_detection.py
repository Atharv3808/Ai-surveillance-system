from django.test import TestCase
from core.ai_engine import SurveillanceAI
import time

class BehaviourDetectionTests(TestCase):
    def setUp(self):
        self.ai = SurveillanceAI()

    def test_ema_smoothing_manual(self):
        # Simulate EMA updates manually since it's inline in process_frame
        pitches = [10, 30, -10]
        smoothed = []
        roll_key = "CS101"
        for p in pitches:
            if roll_key in self.ai.pose_ema:
                ep, ey, er = self.ai.pose_ema[roll_key]
                new_p = self.ai.EMA_ALPHA * p + (1 - self.ai.EMA_ALPHA) * ep
            else:
                new_p = p
            self.ai.pose_ema[roll_key] = (new_p, 0, 0)
            smoothed.append(new_p)

        self.assertEqual(smoothed[0], 10)
        # EMA = 0.4*30 + 0.6*10 = 12 + 6 = 18
        self.assertAlmostEqual(smoothed[1], 18)

    def test_gaze_tracking_suspicious(self):
        alerts = []
        # Add 7 shifts (threshold is 6)
        for _ in range(7):
            self.ai.track_gaze("CS101", "Left", alerts, session_id=1)
            time.sleep(0.01)
        
        self.assertTrue(any(a['type'] == 'looking_left_right' for a in alerts))
