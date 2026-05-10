"""
AI Surveillance Engine — v2
============================
Improvements over v1:
  1. 10-point solvePnP (EPNP) for more accurate head pose.
  2. Per-student Kalman filter (constant-velocity, Mahalanobis outlier gate)
     replaces dual EMA + rolling mean.
  3. Bilateral gaze using both iris landmarks (lm 468, 473) with a vertical
     component (lm 159 / 145), returning a continuous (gaze_x, gaze_y) vector.
  4. Eye Aspect Ratio (EAR) for blink/drowsiness detection.
  5. 10D feature extraction fed to a GradientBoostingClassifier.
  6. Hybrid zone determination: ML when confidence ≥ 0.70, rules otherwise.
  7. Calibration extended to 30 frames; wider normal zone; longer durations.
"""

import cv2
import mediapipe as mp
import numpy as np
import base64
import time
import math
import logging
import face_recognition
from collections import deque
from ultralytics import YOLO

from .kalman_pose import PoseKalmanFilter
from .feature_extractor import (
    BehaviourClassifier,
    extract_features,
    extract_ear,
    extract_gaze_vector,
    gaze_direction_label,
)

logger = logging.getLogger(__name__)


class SurveillanceAI:

    # ── Configuration ─────────────────────────────────────────────────────────

    CALIBRATION_FRAMES      = 30     # ~6 s at 5 fps
    YAW_HISTORY_LEN         = 5      # frames kept for delta/velocity features

    # Relative-angle thresholds (degrees, after baseline subtraction)
    REL_YAW_NORMAL          = 20
    REL_YAW_WARNING         = 35
    REL_PITCH_NORMAL        = 18
    REL_PITCH_WARNING       = 28

    # EAR threshold — below this → eyes closed / looking sharply away
    EAR_LOW_THRESHOLD       = 0.20

    # State-machine durations (seconds)
    WARNING_DURATION        = 3.0
    SUSPICIOUS_DURATION     = 8.0
    RECOVERY_DURATION       = 3.0

    # ML confidence needed to override rules
    ML_CONFIDENCE_THRESHOLD = 0.70

    # Alert cooldowns per severity
    ALERT_COOLDOWN = {'warning': 10, 'suspicious': 30, 'critical': 15}

    # Misc
    MIN_FACE_AREA_RATIO      = 0.005
    BODY_MOVEMENT_THRESHOLD  = 0.15
    MISSING_FACE_THRESHOLD   = 25
    MULTIPLE_FACE_THRESHOLD  = 10
    GAZE_SUSPICIOUS_FRAMES   = 8
    RECALIBRATE_AFTER_MISS   = 50

    # ── 10-point canonical face model (mm, right-handed) ─────────────────────
    _MODEL_PTS_10 = np.array([
        (   0.0,    0.0,    0.0),   # lm 1   — nose tip
        (   0.0, -330.0,  -65.0),   # lm 152 — chin
        (-225.0,  170.0, -135.0),   # lm 33  — left eye outer corner
        ( 225.0,  170.0, -135.0),   # lm 263 — right eye outer corner
        (-150.0, -150.0, -125.0),   # lm 61  — left mouth corner
        ( 150.0, -150.0, -125.0),   # lm 291 — right mouth corner
        (   0.0,   60.0,  -20.0),   # lm 6   — nose bridge
        (   0.0,  195.0,  -30.0),   # lm 10  — forehead centre
        (-280.0,    0.0, -100.0),   # lm 234 — left cheekbone
        ( 280.0,    0.0, -100.0),   # lm 454 — right cheekbone
    ], dtype="double")

    _LM_INDICES_10 = [1, 152, 33, 263, 61, 291, 6, 10, 234, 454]

    # ─────────────────────────────────────────────────────────────────────────

    def __init__(self):
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh    = self.mp_face_mesh.FaceMesh(
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.7,
            min_tracking_confidence=0.6,
        )
        self.mp_pose = mp.solutions.pose
        self.pose    = self.mp_pose.Pose(
            min_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self.yolo_model = YOLO('yolov8n.pt')

        # Face recognition
        self.known_face_encodings  = []
        self.known_face_names      = []
        self.last_known_identities = []

        # Hybrid ML classifier (graceful fallback to rules when absent)
        self.classifier = BehaviourClassifier()
        if self.classifier.available:
            logger.info("ML behaviour classifier loaded.")
        else:
            logger.info("ML classifier not found — running rule-based fallback.")

        # ── Per-student state (keyed by roll number or 'unknown') ─────────────
        self.kalman_filters      = {}   # rk → PoseKalmanFilter
        self.calibration_buffers = {}   # rk → list[(pitch, yaw, roll)]
        self.pose_baselines      = {}   # rk → {'pitch', 'yaw', 'roll'}
        self.is_calibrated       = {}   # rk → bool

        self.yaw_history         = {}   # rk → deque(maxlen=YAW_HISTORY_LEN)
        self.behavior_state      = {}   # rk → state string
        self.abnormal_since      = {}   # rk → wall-clock timestamp
        self.normal_since        = {}   # rk → wall-clock timestamp

        self.gaze_history        = {}   # rk → deque of off-center frames
        self.body_history        = {}   # rk → deque of shoulder-Y values

        # ── Alert cooldown table ─────────────────────────────────────────────
        self.alert_cooldowns = {}       # "type:roll" → last emission time

        # ── Global debounce counters ─────────────────────────────────────────
        self.face_missing_frames   = 0
        self.multiple_faces_frames = 0

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    def load_known_faces(self):
        from api.models import FaceEmbedding
        embs = FaceEmbedding.objects.select_related('student').all()
        self.known_face_encodings = [np.array(e.embedding_data) for e in embs]
        self.known_face_names     = [e.student.roll_number for e in embs]

    def reset_calibration(self, roll_key=None):
        """Clear calibration state for one student, or all if roll_key is None."""
        targets = ([roll_key] if roll_key
                   else list(set(list(self.is_calibrated) + list(self.calibration_buffers))))
        for k in targets:
            for d in (self.calibration_buffers, self.pose_baselines, self.is_calibrated,
                      self.behavior_state, self.abnormal_since, self.normal_since,
                      self.yaw_history):
                d.pop(k, None)
            if k in self.kalman_filters:
                self.kalman_filters[k].reset()

    # ─────────────────────────────────────────────────────────────────────────
    # Head pose — 10-point EPNP
    # ─────────────────────────────────────────────────────────────────────────

    def get_head_pose(self, face_landmarks, img_w, img_h):
        """Return (pitch, yaw, roll) in degrees, each clamped to [–90, 90]."""
        lm = face_landmarks.landmark
        image_points = np.array(
            [(lm[i].x * img_w, lm[i].y * img_h) for i in self._LM_INDICES_10],
            dtype="double",
        )

        cam = np.array([
            [img_w, 0,     img_w / 2],
            [0,     img_w, img_h / 2],
            [0,     0,     1],
        ], dtype="double")

        ok, rvec, _ = cv2.solvePnP(
            self._MODEL_PTS_10, image_points, cam, np.zeros((4, 1)),
            flags=cv2.SOLVEPNP_EPNP,
        )
        if not ok:
            return 0.0, 0.0, 0.0

        rmat, _ = cv2.Rodrigues(rvec)

        sy = math.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
        if sy > 1e-6:
            pitch = math.degrees(math.atan2( rmat[2, 1],  rmat[2, 2]))
            yaw   = math.degrees(math.atan2(-rmat[2, 0],  sy))
            roll  = math.degrees(math.atan2( rmat[1, 0],  rmat[0, 0]))
        else:
            pitch = math.degrees(math.atan2(-rmat[1, 2],  rmat[1, 1]))
            yaw   = math.degrees(math.atan2(-rmat[2, 0],  sy))
            roll  = 0.0

        return (
            float(np.clip(pitch, -90.0, 90.0)),
            float(np.clip(yaw,   -90.0, 90.0)),
            float(np.clip(roll,  -90.0, 90.0)),
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Zone determination — hybrid (ML preferred, rules as fallback)
    # ─────────────────────────────────────────────────────────────────────────

    def _zone_from_angles(self, rel_yaw, rel_pitch):
        ay, ap = abs(rel_yaw), abs(rel_pitch)
        if ay > self.REL_YAW_WARNING or ap > self.REL_PITCH_WARNING:
            return 'suspicious'
        if ay > self.REL_YAW_NORMAL or ap > self.REL_PITCH_NORMAL:
            return 'warning'
        return 'normal'

    def _zone_hybrid(self, features, rel_yaw, rel_pitch):
        """
        Return (zone, ml_used, ml_conf).
        ML result is used only when confidence ≥ ML_CONFIDENCE_THRESHOLD.
        """
        if self.classifier.available:
            label, conf = self.classifier.predict(features)
            if label is not None and conf >= self.ML_CONFIDENCE_THRESHOLD:
                return label.lower(), True, conf
        return self._zone_from_angles(rel_yaw, rel_pitch), False, 0.0

    # ─────────────────────────────────────────────────────────────────────────
    # Behaviour state machine (time-based, monotone escalation)
    # ─────────────────────────────────────────────────────────────────────────

    def _update_behavior_state(self, roll_key, zone, ts):
        current = self.behavior_state.get(roll_key, 'Normal')

        if zone == 'normal':
            self.abnormal_since.pop(roll_key, None)
            if roll_key not in self.normal_since:
                self.normal_since[roll_key] = ts
            if ts - self.normal_since[roll_key] >= self.RECOVERY_DURATION:
                return 'Normal'
            return current

        else:
            self.normal_since.pop(roll_key, None)
            if roll_key not in self.abnormal_since:
                self.abnormal_since[roll_key] = ts
            abn_dur = ts - self.abnormal_since[roll_key]

            if zone == 'suspicious' and abn_dur >= self.SUSPICIOUS_DURATION:
                target = 'Suspicious'
            elif abn_dur >= self.WARNING_DURATION:
                target = 'Warning'
            else:
                return current

            order = {'Normal': 0, 'Warning': 1, 'Suspicious': 2, 'Critical': 3}
            return target if order.get(target, 0) > order.get(current, 0) else current

    # ─────────────────────────────────────────────────────────────────────────
    # Head direction label
    # ─────────────────────────────────────────────────────────────────────────

    def _head_dir_from_relative(self, rel_yaw, rel_pitch):
        ay, ap = abs(rel_yaw), abs(rel_pitch)
        if ap >= self.REL_PITCH_NORMAL:
            return 'Down' if rel_pitch < 0 else 'Up'
        if ay >= self.REL_YAW_NORMAL:
            return 'Left' if rel_yaw < 0 else 'Right'
        return 'Center'

    # ─────────────────────────────────────────────────────────────────────────
    # Body movement tracking
    # ─────────────────────────────────────────────────────────────────────────

    def _track_body(self, pose_res, roll_key, alerts, session_id):
        if not pose_res.pose_landmarks:
            return
        lm    = pose_res.pose_landmarks.landmark
        avg_y = (lm[11].y + lm[12].y) / 2.0
        if roll_key not in self.body_history:
            self.body_history[roll_key] = deque(maxlen=20)
        self.body_history[roll_key].append(avg_y)
        if len(self.body_history[roll_key]) == 20:
            vals = list(self.body_history[roll_key])
            if (max(vals) - min(vals)) > self.BODY_MOVEMENT_THRESHOLD:
                self.add_alert(alerts, 'suspicious_body_movement',
                               'Abnormal body/posture movement detected',
                               0.85, session_id, 'suspicious',
                               roll_key if roll_key != 'unknown' else None)
                self.body_history[roll_key].clear()

    # ─────────────────────────────────────────────────────────────────────────
    # Gaze tracking
    # ─────────────────────────────────────────────────────────────────────────

    def _track_gaze(self, roll_key, gaze_dir, alerts, session_id):
        if roll_key not in self.gaze_history:
            self.gaze_history[roll_key] = deque(maxlen=self.GAZE_SUSPICIOUS_FRAMES)
        self.gaze_history[roll_key].append(gaze_dir)
        if len(self.gaze_history[roll_key]) >= self.GAZE_SUSPICIOUS_FRAMES:
            self.add_alert(alerts, 'looking_left_right',
                           f'Repeated gaze shifting ({gaze_dir}) detected',
                           0.9, session_id, 'suspicious',
                           roll_key if roll_key != 'unknown' else None)
            self.gaze_history[roll_key].clear()

    # ─────────────────────────────────────────────────────────────────────────
    # Face matching with identity persistence
    # ─────────────────────────────────────────────────────────────────────────

    def _match_face(self, face_enc, face_loc, ts):
        name, conf = 'Unknown', 0.0
        if not self.known_face_encodings:
            return name, conf
        dists = face_recognition.face_distance(self.known_face_encodings, face_enc)
        best  = int(np.argmin(dists))
        thr   = 0.55
        for pb, _, pt in self.last_known_identities:
            if ts - pt < 2.0:
                cx = (face_loc[1] + face_loc[3]) / 2
                cy = (face_loc[0] + face_loc[2]) / 2
                px = (pb[1] + pb[3]) / 2
                py = (pb[0] + pb[2]) / 2
                if math.hypot(cx - px, cy - py) < 100:
                    thr = 0.65
                    break
        if dists[best] < thr:
            name = self.known_face_names[best]
            conf = float(1.0 - dists[best])
        return name, conf

    # ─────────────────────────────────────────────────────────────────────────
    # Alert emission with per-student, per-type cooldown
    # ─────────────────────────────────────────────────────────────────────────

    def add_alert(self, alert_list, a_type, msg, conf, session_id,
                  severity='warning', roll=None):
        key      = f'{a_type}:{roll if (roll and roll != "Unknown") else "global"}'
        cooldown = self.ALERT_COOLDOWN.get(severity, 30)
        if (time.time() - self.alert_cooldowns.get(key, 0)) > cooldown:
            alert_list.append({
                'type':         a_type,
                'message':      msg,
                'confidence':   float(conf),
                'severity':     severity,
                'student_roll': roll if roll != 'Unknown' else None,
            })
            self.alert_cooldowns[key] = time.time()

    # ─────────────────────────────────────────────────────────────────────────
    # Main frame processor
    # ─────────────────────────────────────────────────────────────────────────

    def process_frame(self, frame_data, session_id):
        try:
            # ── Decode ────────────────────────────────────────────────────────
            _, imgstr = frame_data.split(';base64,')
            frame = cv2.imdecode(
                np.frombuffer(base64.b64decode(imgstr), np.uint8),
                cv2.IMREAD_COLOR,
            )
            if frame is None:
                return None, [], None

            img_h, img_w = frame.shape[:2]
            rgb          = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            ts           = time.time()

            # ── YOLO person count ─────────────────────────────────────────────
            yolo_res    = self.yolo_model(frame, classes=[0], verbose=False)[0]
            num_persons = len(yolo_res.boxes)

            # ── MediaPipe face mesh + body pose ───────────────────────────────
            mesh_res = self.face_mesh.process(rgb)
            pose_res = self.pose.process(rgb)

            # Build bounding boxes from mesh landmarks (filter tiny/background faces)
            min_px    = img_w * img_h * self.MIN_FACE_AREA_RATIO
            face_locs = []
            if mesh_res.multi_face_landmarks:
                for flm in mesh_res.multi_face_landmarks:
                    xs = [lm.x * img_w for lm in flm.landmark]
                    ys = [lm.y * img_h for lm in flm.landmark]
                    t  = max(0,     int(min(ys)) - 20)
                    b  = min(img_h, int(max(ys)) + 20)
                    l  = max(0,     int(min(xs)) - 20)
                    r  = min(img_w, int(max(xs)) + 20)
                    if (r - l) * (b - t) >= min_px and t < b:
                        face_locs.append((t, r, b, l))

            face_encs  = face_recognition.face_encodings(rgb, face_locs)
            detections = []
            alerts     = []

            # Expire stale identity cache (> 2 s old)
            self.last_known_identities = [
                i for i in self.last_known_identities if ts - i[2] < 2.0
            ]

            recognized_rolls = []
            for face_loc, face_enc in zip(face_locs, face_encs):
                t, r, b, l = face_loc
                name, conf = self._match_face(face_enc, face_loc, ts)
                recognized_rolls.append(name)
                self.last_known_identities.append((face_loc, name, ts))
                detections.append({
                    'bbox':           [l, t, r, b],
                    'name':           name,
                    'confidence':     conf,
                    'gaze':           'Center',
                    'head_direction': 'Center',
                    'status':         'Normal',
                    'pitch':          0.0,
                    'yaw':            0.0,
                    'rel_pitch':      0.0,
                    'rel_yaw':        0.0,
                    'ear':            0.30,
                    '_debug':         {},
                })

            # ── Multiple-face debounce ────────────────────────────────────────
            if num_persons > 1 or (mesh_res.multi_face_landmarks and
                                   len(mesh_res.multi_face_landmarks) > 1):
                self.multiple_faces_frames += 1
                if self.multiple_faces_frames >= self.MULTIPLE_FACE_THRESHOLD:
                    self.add_alert(alerts, 'multiple_faces',
                                   f'Multiple persons ({num_persons}) detected',
                                   1.0, session_id, 'critical')
            else:
                self.multiple_faces_frames = max(0, self.multiple_faces_frames - 1)

            # ── Per-face behaviour analysis ───────────────────────────────────
            if mesh_res.multi_face_landmarks:
                self.face_missing_frames = 0

                for idx, face_lm in enumerate(mesh_res.multi_face_landmarks):
                    roll = recognized_rolls[idx] if idx < len(recognized_rolls) else None
                    rk   = roll or 'unknown'

                    # ── 1. Raw head pose (10-pt EPNP) ─────────────────────────
                    rp, ry, rr = self.get_head_pose(face_lm, img_w, img_h)

                    # ── 2. Kalman filter smoothing ────────────────────────────
                    if rk not in self.kalman_filters:
                        self.kalman_filters[rk] = PoseKalmanFilter()
                    kf = self.kalman_filters[rk]
                    s_pitch, s_yaw, s_roll = kf.update(rp, ry, rr, ts)
                    vel_pitch, vel_yaw, _  = kf.velocity

                    # ── 3. Calibration ────────────────────────────────────────
                    calibrated = self.is_calibrated.get(rk, False)

                    if not calibrated:
                        if rk not in self.calibration_buffers:
                            self.calibration_buffers[rk] = []
                        self.calibration_buffers[rk].append((s_pitch, s_yaw, s_roll))
                        n_cal = len(self.calibration_buffers[rk])

                        if n_cal >= self.CALIBRATION_FRAMES:
                            cal = self.calibration_buffers[rk]
                            self.pose_baselines[rk] = {
                                'pitch': float(np.median([c[0] for c in cal])),
                                'yaw':   float(np.median([c[1] for c in cal])),
                                'roll':  float(np.median([c[2] for c in cal])),
                            }
                            self.is_calibrated[rk]  = True
                            self.behavior_state[rk] = 'Normal'

                        if idx < len(detections):
                            detections[idx].update({
                                'status': 'Calibrating',
                                'pitch':  round(s_pitch, 1),
                                'yaw':    round(s_yaw,   1),
                                '_debug': {
                                    'phase':  'calibrating',
                                    'frames': n_cal,
                                    'target': self.CALIBRATION_FRAMES,
                                },
                            })
                        continue

                    # ── 4. Relative angles ────────────────────────────────────
                    bl        = self.pose_baselines[rk]
                    rel_pitch = s_pitch - bl['pitch']
                    rel_yaw   = s_yaw   - bl['yaw']
                    rel_roll  = s_roll  - bl['roll']

                    # ── 5. Bilateral gaze ─────────────────────────────────────
                    gaze_x, gaze_y = extract_gaze_vector(face_lm)
                    gaze_dir = gaze_direction_label(gaze_x, gaze_y)

                    # ── 6. EAR ────────────────────────────────────────────────
                    ear = extract_ear(face_lm, img_w, img_h)

                    # ── 7. Face area ratio ────────────────────────────────────
                    if idx < len(face_locs):
                        ft, fr, fb, fl = face_locs[idx]
                        face_area = ((fr - fl) * (fb - ft)) / (img_w * img_h)
                    else:
                        face_area = 0.0

                    # ── 8. Yaw history (for delta feature) ───────────────────
                    if rk not in self.yaw_history:
                        self.yaw_history[rk] = deque(maxlen=self.YAW_HISTORY_LEN)
                    self.yaw_history[rk].append(s_yaw)

                    # ── 9. Feature vector ─────────────────────────────────────
                    features = extract_features(
                        rel_yaw, rel_pitch, rel_roll,
                        gaze_x, gaze_y, ear,
                        vel_yaw, vel_pitch,
                        face_area, list(self.yaw_history[rk]),
                    )

                    # ── 10. Hybrid zone determination ─────────────────────────
                    zone, ml_used, ml_conf = self._zone_hybrid(features, rel_yaw, rel_pitch)

                    # ── 11. State machine ─────────────────────────────────────
                    new_state = self._update_behavior_state(rk, zone, ts)
                    self.behavior_state[rk] = new_state

                    head_dir = self._head_dir_from_relative(rel_yaw, rel_pitch)

                    # ── 12. Alerts ────────────────────────────────────────────
                    if new_state == 'Suspicious':
                        self.add_alert(alerts, 'suspicious_head_movement',
                                       f'Sustained head direction: {head_dir}',
                                       0.8, session_id, 'suspicious', roll)

                    if gaze_dir != 'Center':
                        self._track_gaze(rk, gaze_dir, alerts, session_id)
                    elif rk in self.gaze_history:
                        self.gaze_history[rk].clear()

                    if ear < self.EAR_LOW_THRESHOLD:
                        self.add_alert(alerts, 'eyes_closed',
                                       'Eyes appear closed or averted',
                                       0.75, session_id, 'warning', roll)

                    if idx == 0:
                        self._track_body(pose_res, rk, alerts, session_id)

                    # ── 13. Detection payload update ──────────────────────────
                    det_status = new_state
                    if roll == 'Unknown' and det_status == 'Normal':
                        det_status = 'Warning'

                    if idx < len(detections):
                        abn_dur    = ts - self.abnormal_since.get(rk, ts)
                        gaze_count = len(self.gaze_history.get(rk, []))
                        detections[idx].update({
                            'gaze':           gaze_dir,
                            'head_direction': head_dir,
                            'pitch':          round(s_pitch,   1),
                            'yaw':            round(s_yaw,     1),
                            'rel_pitch':      round(rel_pitch, 1),
                            'rel_yaw':        round(rel_yaw,   1),
                            'ear':            round(ear,       3),
                            'status':         det_status,
                            '_debug': {
                                'phase':          'active',
                                'state':          new_state,
                                'zone':           zone,
                                'ml_used':        ml_used,
                                'ml_conf':        round(ml_conf, 3),
                                'head_dir':       head_dir,
                                'rel_yaw':        round(rel_yaw,   1),
                                'rel_pitch':      round(rel_pitch, 1),
                                'rel_roll':       round(rel_roll,  1),
                                'smoothed_yaw':   round(s_yaw,   1),
                                'smoothed_pitch': round(s_pitch, 1),
                                'baseline_yaw':   round(bl['yaw'],   1),
                                'baseline_pitch': round(bl['pitch'], 1),
                                'raw_yaw':        round(ry, 1),
                                'raw_pitch':      round(rp, 1),
                                'vel_yaw':        round(vel_yaw,   2),
                                'vel_pitch':      round(vel_pitch, 2),
                                'ear':            round(ear, 3),
                                'gaze_x':         round(gaze_x, 3),
                                'gaze_y':         round(gaze_y, 3),
                                'gaze_count':     gaze_count,
                                'abnormal_s':     round(abn_dur, 1),
                            },
                        })

            else:
                # No face detected
                self.face_missing_frames += 1
                if self.face_missing_frames == self.RECALIBRATE_AFTER_MISS:
                    self.reset_calibration()
                if self.face_missing_frames >= self.MISSING_FACE_THRESHOLD:
                    self.add_alert(alerts, 'face_missing',
                                   'Face not visible in frame',
                                   1.0, session_id, 'warning')

            return detections, alerts, frame

        except Exception:
            logger.error("AI Engine Error", exc_info=True)
            return None, [], None
