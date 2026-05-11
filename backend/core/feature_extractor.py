"""
Feature extraction and ML-based behaviour classification.

Feature vector (10D):
  0  rel_yaw         — relative yaw after baseline subtraction (°)
  1  rel_pitch       — relative pitch after baseline subtraction (°)
  2  rel_roll        — relative roll after baseline subtraction (°)
  3  gaze_x          — horizontal gaze deviation  (–1 left … +1 right)
  4  gaze_y          — vertical gaze deviation    (–1 up  … +1 down)
  5  ear_avg         — average Eye Aspect Ratio
  6  vel_yaw         — Kalman yaw angular velocity (°/s)
  7  vel_pitch       — Kalman pitch angular velocity (°/s)
  8  face_area       — face bounding-box area as fraction of frame
  9  yaw_delta_3f    — yaw change across last 3 Kalman outputs (°)
"""

import os
import numpy as np

_MODEL_PATH  = os.path.join(os.path.dirname(__file__), 'ml_models', 'behaviour_classifier.pkl')
_SCALER_PATH = os.path.join(os.path.dirname(__file__), 'ml_models', 'feature_scaler.pkl')

FEATURE_NAMES = [
    'rel_yaw', 'rel_pitch', 'rel_roll',
    'gaze_x', 'gaze_y', 'ear_avg',
    'vel_yaw', 'vel_pitch',
    'face_area', 'yaw_delta_3f',
]
CLASS_LABELS = ['Normal', 'Warning', 'Suspicious']

# ── EAR landmark index sets ───────────────────────────────────────────────────
# Per the MediaPipe 478-landmark topology (with refine_landmarks=True)
_L_EYE = [33, 160, 158, 133, 153, 144]    # left  eye: outer,p1,p2,inner,p4,p5
_R_EYE = [362, 385, 387, 263, 373, 380]   # right eye: outer,p1,p2,inner,p4,p5


# ─────────────────────────────────────────────────────────────────────────────
# EAR  (Eye Aspect Ratio)
# ─────────────────────────────────────────────────────────────────────────────

def _ear_single(lm, indices, img_w, img_h):
    pts = [(lm[i].x * img_w, lm[i].y * img_h) for i in indices]
    v1 = np.linalg.norm(np.array(pts[1]) - np.array(pts[5]))
    v2 = np.linalg.norm(np.array(pts[2]) - np.array(pts[4]))
    h  = np.linalg.norm(np.array(pts[0]) - np.array(pts[3]))
    return (v1 + v2) / (2.0 * h) if h > 0 else 0.30


def extract_ear(face_landmarks, img_w, img_h) -> float:
    """Mean EAR across both eyes.  ~0.30 open, ~0.18 closed."""
    lm = face_landmarks.landmark
    return (_ear_single(lm, _L_EYE, img_w, img_h) +
            _ear_single(lm, _R_EYE, img_w, img_h)) / 2.0


# ─────────────────────────────────────────────────────────────────────────────
# Bilateral gaze vector
# ─────────────────────────────────────────────────────────────────────────────

def extract_gaze_vector(face_landmarks) -> tuple:
    """
    Return (gaze_x, gaze_y) each in [–1, +1].
    Uses both iris landmarks (lm 468 left, lm 473 right) for horizontal;
    upper/lower lid positions for vertical.
    gaze_x > 0 → looking right;  gaze_y > 0 → looking down.
    """
    lm = face_landmarks.landmark

    def _horiz(iris_idx, outer_idx, inner_idx):
        eye_w = lm[inner_idx].x - lm[outer_idx].x
        if abs(eye_w) < 1e-4:
            return 0.0
        ratio = (lm[iris_idx].x - lm[outer_idx].x) / eye_w
        return float(np.clip((ratio - 0.5) * 2.0, -1.0, 1.0))

    def _vert(iris_idx, upper_idx, lower_idx):
        eye_h = lm[lower_idx].y - lm[upper_idx].y
        if abs(eye_h) < 1e-4:
            return 0.0
        ratio = (lm[iris_idx].y - lm[upper_idx].y) / eye_h
        return float(np.clip((ratio - 0.5) * 2.0, -1.0, 1.0))

    gaze_x = (_horiz(468, 33, 133) + _horiz(473, 362, 263)) / 2.0
    gaze_y = _vert(468, 159, 145)

    return float(np.clip(gaze_x, -1.0, 1.0)), float(np.clip(gaze_y, -1.0, 1.0))


def gaze_direction_label(gaze_x: float, gaze_y: float) -> str:
    # 0.5 threshold (~25 % of eye width from centre) reduces landmark-noise false positives
    if abs(gaze_y) > 0.5:
        return 'Down' if gaze_y > 0 else 'Up'
    if abs(gaze_x) > 0.5:
        return 'Right' if gaze_x > 0 else 'Left'
    return 'Center'


# ─────────────────────────────────────────────────────────────────────────────
# Feature vector assembly
# ─────────────────────────────────────────────────────────────────────────────

def extract_features(rel_yaw, rel_pitch, rel_roll,
                     gaze_x, gaze_y, ear_avg,
                     vel_yaw, vel_pitch,
                     face_area_ratio, yaw_history) -> np.ndarray:
    """Build the 10D feature vector.  yaw_history is a list of recent yaws."""
    if len(yaw_history) >= 3:
        yaw_delta_3f = float(yaw_history[-1]) - float(yaw_history[-3])
    elif len(yaw_history) >= 2:
        yaw_delta_3f = float(yaw_history[-1]) - float(yaw_history[-2])
    else:
        yaw_delta_3f = 0.0

    return np.array([
        rel_yaw, rel_pitch, rel_roll,
        gaze_x, gaze_y, ear_avg,
        vel_yaw, vel_pitch,
        face_area_ratio, yaw_delta_3f,
    ], dtype=np.float32)


# ─────────────────────────────────────────────────────────────────────────────
# ML Behaviour Classifier
# ─────────────────────────────────────────────────────────────────────────────

class BehaviourClassifier:
    """
    Wraps a scikit-learn GradientBoostingClassifier.
    Gracefully degrades to unavailable when scikit-learn or the model file
    are absent — the engine will use rule-based logic in that case.
    """

    def __init__(self):
        self._model     = None
        self._scaler    = None
        self._available = False
        self._load()

    def _load(self):
        try:
            import joblib
            if os.path.exists(_MODEL_PATH) and os.path.exists(_SCALER_PATH):
                self._model     = joblib.load(_MODEL_PATH)
                self._scaler    = joblib.load(_SCALER_PATH)
                self._available = True
        except Exception:
            pass

    @property
    def available(self) -> bool:
        return self._available

    def predict(self, features: np.ndarray) -> tuple:
        """
        Return (label: str | None, confidence: float).
        label is one of CLASS_LABELS or None if unavailable.
        """
        if not self._available:
            return None, 0.0
        try:
            x     = self._scaler.transform(features.reshape(1, -1))
            proba = self._model.predict_proba(x)[0]
            idx   = int(np.argmax(proba))
            return CLASS_LABELS[idx], float(proba[idx])
        except Exception:
            return None, 0.0
