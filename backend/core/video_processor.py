"""
Video Behaviour Analysis Processor
====================================
Processes an uploaded video file frame-by-frame using the same AI pipeline
as live monitoring, but adapted for offline (video-timestamp-based) use:

  - State machine timers advance using video_ts (frame / fps), not wall clock.
  - Alert cooldowns are measured in video seconds, not real seconds.
  - Evidence frames are saved as JPEG via Django's ContentFile.
  - Progress is persisted to DB every 50 processed frames.
  - Runs in a background daemon thread; closes DB connection when done.
"""

import cv2
import numpy as np
import math
import logging
import face_recognition
from collections import deque
from django.core.files.base import ContentFile
from ultralytics import YOLO
import mediapipe as mp

from .kalman_pose import PoseKalmanFilter
from .feature_extractor import (
    BehaviourClassifier,
    extract_features,
    extract_ear,
    extract_gaze_vector,
    gaze_direction_label,
)

logger = logging.getLogger(__name__)


class VideoProcessor:

    # ── Thresholds (mirrored from SurveillanceAI, but durations are VIDEO seconds) ──
    CALIBRATION_FRAMES      = 30
    YAW_HISTORY_LEN         = 5

    REL_YAW_NORMAL          = 20
    REL_YAW_WARNING         = 35
    REL_PITCH_NORMAL        = 18
    REL_PITCH_WARNING       = 28
    EAR_LOW_THRESHOLD       = 0.20
    ML_CONFIDENCE_THRESHOLD = 0.70

    # Alert cooldowns in VIDEO seconds (longer than live because we see full context)
    ALERT_COOLDOWN = {'warning': 20, 'suspicious': 60, 'critical': 30}

    # State-machine durations in VIDEO seconds
    WARNING_DURATION    = 3.0
    SUSPICIOUS_DURATION = 8.0
    RECOVERY_DURATION   = 3.0

    # Face-missing / multiple-faces debounce in VIDEO seconds
    FACE_MISSING_DEBOUNCE   = 5.0
    MULTIPLE_FACE_DEBOUNCE  = 2.0

    # 10-point canonical face model (same as ai_engine.py)
    _MODEL_PTS_10 = np.array([
        (   0.0,    0.0,    0.0),
        (   0.0, -330.0,  -65.0),
        (-225.0,  170.0, -135.0),
        ( 225.0,  170.0, -135.0),
        (-150.0, -150.0, -125.0),
        ( 150.0, -150.0, -125.0),
        (   0.0,   60.0,  -20.0),
        (   0.0,  195.0,  -30.0),
        (-280.0,    0.0, -100.0),
        ( 280.0,    0.0, -100.0),
    ], dtype="double")

    _LM_INDICES_10 = [1, 152, 33, 263, 61, 291, 6, 10, 234, 454]

    # ─────────────────────────────────────────────────────────────────────────

    def __init__(self, video_id: int):
        self.video_id = video_id

        # AI models — each processor gets its own instance
        _mp_fm = mp.solutions.face_mesh
        self.face_mesh = _mp_fm.FaceMesh(
            max_num_faces=2, refine_landmarks=True,
            min_detection_confidence=0.7, min_tracking_confidence=0.6,
        )
        _mp_p = mp.solutions.pose
        self.pose = _mp_p.Pose(
            min_detection_confidence=0.6, min_tracking_confidence=0.6,
        )
        self.yolo = YOLO('yolov8n.pt')

        # Face recognition
        self.known_encodings = []
        self.known_names     = []
        self._load_faces()

        # ML classifier
        self.classifier = BehaviourClassifier()

        # Per-student state (keyed by roll number or 'unknown')
        self.kalman_filters      = {}
        self.calibration_buffers = {}
        self.pose_baselines      = {}
        self.is_calibrated       = {}
        self.yaw_history         = {}
        self.behavior_state      = {}
        self.abnormal_since      = {}   # rk → video_ts
        self.normal_since        = {}   # rk → video_ts
        self.gaze_history        = {}
        self.body_history        = {}

        # Alert cooldowns (video-timestamp based)
        self.alert_last_vts = {}        # "type:roll" → video_ts of last emission

        # Debounce: timestamp when condition first started
        self.face_missing_since  = None
        self.multi_face_since    = None

    # ─────────────────────────────────────────────────────────────────────────
    # Public entry point
    # ─────────────────────────────────────────────────────────────────────────

    def process(self):
        """Call from a background thread. Handles its own DB lifecycle."""
        from django.db import connection
        try:
            self._run()
        except Exception as exc:
            logger.error("Video processing failed", exc_info=True)
            from api.models import UploadedVideo
            UploadedVideo.objects.filter(id=self.video_id).update(
                status='failed', error_message=str(exc)[:1000]
            )
        finally:
            try:
                self.face_mesh.close()
                self.pose.close()
            except Exception:
                pass
            connection.close()

    # ─────────────────────────────────────────────────────────────────────────
    # Main processing loop
    # ─────────────────────────────────────────────────────────────────────────

    def _run(self):
        import time as _time
        from django.utils import timezone
        from api.models import UploadedVideo, VideoAnalysisResult, VideoAlert, VideoEvidenceFrame

        video_obj  = UploadedVideo.objects.get(id=self.video_id)
        video_path = video_obj.video_file.path

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {video_path}")

        fps          = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width        = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration     = total_frames / fps if fps > 0 else 0

        UploadedVideo.objects.filter(id=self.video_id).update(
            fps=round(fps, 2),
            duration=round(duration, 1),
            resolution=f"{width}x{height}",
            total_frames=total_frames,
            status='processing',
            progress=0.0,
        )

        skip = self._frame_skip(duration)
        logger.info(f"[VideoProc {self.video_id}] {total_frames} frames, {fps:.1f} fps, skip={skip}")

        start_rt       = _time.time()
        frame_num      = 0
        processed_cnt  = 0
        total_alerts   = 0
        sev_counts     = {'warning': 0, 'suspicious': 0, 'critical': 0}
        conf_sum       = 0.0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_num % skip == 0:
                video_ts   = frame_num / fps
                new_alerts = self._process_frame(frame, video_ts)

                for ad in new_alerts:
                    sev = ad['severity']
                    
                    alert_obj = VideoAlert.objects.create(
                        uploaded_video     = video_obj,
                        alert_type         = ad['type'],
                        severity           = sev,
                        timestamp_in_video = round(video_ts, 2),
                        frame_number       = frame_num,
                        confidence_score   = ad['confidence'],
                        reason             = ad['message'],
                        behaviour_status   = ad.get('behaviour_status', 'Normal'),
                    )

                    # Build evidence if suspicious / critical
                    if sev in ('suspicious', 'critical'):
                        orig_file, overlay_file = self._make_evidence_files(
                            frame, video_ts, frame_num, ad
                        )
                        if orig_file:
                            VideoEvidenceFrame.objects.create(
                                uploaded_video     = video_obj,
                                alert              = alert_obj,
                                frame_number       = frame_num,
                                timestamp_in_video = round(video_ts, 2),
                                image              = orig_file,
                                overlay_image      = overlay_file,
                            )
                            # Link to VideoAlert as well for backward compat/convenience
                            alert_obj.evidence_image = overlay_file or orig_file
                            alert_obj.save()

                    sev_counts[sev] = sev_counts.get(sev, 0) + 1
                    conf_sum += ad['confidence']
                    total_alerts += 1

                processed_cnt += 1

                if processed_cnt % 50 == 0:
                    pct = min(95.0, (frame_num / max(1, total_frames)) * 100)
                    UploadedVideo.objects.filter(id=self.video_id).update(progress=round(pct, 1))

            frame_num += 1

        cap.release()
        proc_time = _time.time() - start_rt
        avg_conf  = conf_sum / total_alerts if total_alerts else 0.0

        VideoAnalysisResult.objects.create(
            uploaded_video    = video_obj,
            total_frames      = total_frames,
            processed_frames  = processed_cnt,
            total_alerts      = total_alerts,
            warning_count     = sev_counts.get('warning', 0),
            suspicious_count  = sev_counts.get('suspicious', 0),
            critical_count    = sev_counts.get('critical', 0),
            average_confidence= round(avg_conf, 3),
            processing_time   = round(proc_time, 1),
        )

        UploadedVideo.objects.filter(id=self.video_id).update(
            status='completed',
            progress=100.0,
            processed_at=timezone.now(),
        )
        logger.info(
            f"[VideoProc {self.video_id}] Done in {proc_time:.1f}s "
            f"— {total_alerts} alerts ({sev_counts})"
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Per-frame analysis
    # ─────────────────────────────────────────────────────────────────────────

    def _process_frame(self, frame, video_ts: float) -> list:
        try:
            img_h, img_w = frame.shape[:2]
            rgb          = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            alerts       = []

            yolo_res    = self.yolo(frame, classes=[0], verbose=False)[0]
            num_persons = len(yolo_res.boxes)

            mesh_res = self.face_mesh.process(rgb)
            pose_res = self.pose.process(rgb)

            # Build face bboxes
            min_px    = img_w * img_h * 0.005
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

            face_encs = face_recognition.face_encodings(rgb, face_locs)
            recognized = [self._match_face(enc) for enc in face_encs]

            # Multiple-faces debounce
            if num_persons > 1 or (mesh_res.multi_face_landmarks and
                                   len(mesh_res.multi_face_landmarks) > 1):
                if self.multi_face_since is None:
                    self.multi_face_since = video_ts
                elif video_ts - self.multi_face_since >= self.MULTIPLE_FACE_DEBOUNCE:
                    self._emit(alerts, 'multiple_faces',
                               f'Multiple persons ({num_persons}) detected',
                               1.0, 'critical', None, video_ts)
            else:
                self.multi_face_since = None

            if mesh_res.multi_face_landmarks:
                self.face_missing_since = None

                for idx, face_lm in enumerate(mesh_res.multi_face_landmarks):
                    roll = recognized[idx] if idx < len(recognized) else None
                    rk   = roll or 'unknown'

                    # Head pose
                    rp, ry, rr = self._head_pose(face_lm, img_w, img_h)

                    # Kalman (with video_ts so velocity is in °/video-s)
                    if rk not in self.kalman_filters:
                        self.kalman_filters[rk] = PoseKalmanFilter()
                    kf = self.kalman_filters[rk]
                    s_pitch, s_yaw, s_roll = kf.update(rp, ry, rr, ts=video_ts)
                    vel_pitch, vel_yaw, _  = kf.velocity

                    # Calibration
                    if not self.is_calibrated.get(rk, False):
                        buf = self.calibration_buffers.setdefault(rk, [])
                        buf.append((s_pitch, s_yaw, s_roll))
                        if len(buf) >= self.CALIBRATION_FRAMES:
                            self.pose_baselines[rk] = {
                                'pitch': float(np.median([c[0] for c in buf])),
                                'yaw':   float(np.median([c[1] for c in buf])),
                                'roll':  float(np.median([c[2] for c in buf])),
                            }
                            self.is_calibrated[rk]  = True
                            self.behavior_state[rk] = 'Normal'
                        continue

                    bl        = self.pose_baselines[rk]
                    rel_pitch = s_pitch - bl['pitch']
                    rel_yaw   = s_yaw   - bl['yaw']
                    rel_roll  = s_roll  - bl['roll']

                    gaze_x, gaze_y = extract_gaze_vector(face_lm)
                    gaze_dir = gaze_direction_label(gaze_x, gaze_y)
                    ear      = extract_ear(face_lm, img_w, img_h)

                    if idx < len(face_locs):
                        ft, fr, fb, fl = face_locs[idx]
                        face_area = ((fr - fl) * (fb - ft)) / (img_w * img_h)
                    else:
                        face_area = 0.0

                    yh = self.yaw_history.setdefault(rk, deque(maxlen=self.YAW_HISTORY_LEN))
                    yh.append(s_yaw)

                    features = extract_features(
                        rel_yaw, rel_pitch, rel_roll,
                        gaze_x, gaze_y, ear,
                        vel_yaw, vel_pitch,
                        face_area, list(yh),
                    )

                    zone, _, _ = self._zone_hybrid(features, rel_yaw, rel_pitch)
                    new_state  = self._update_state(rk, zone, video_ts)
                    self.behavior_state[rk] = new_state

                    head_dir = self._head_dir(rel_yaw, rel_pitch)

                    if new_state == 'Suspicious':
                        self._emit(alerts, 'suspicious_head_movement',
                                   f'Sustained head direction: {head_dir}',
                                   0.8, 'suspicious', roll, video_ts,
                                   bstatus=new_state)

                    if gaze_dir != 'Center':
                        gh = self.gaze_history.setdefault(rk, deque(maxlen=8))
                        gh.append(gaze_dir)
                        if len(gh) >= 8:
                            self._emit(alerts, 'looking_left_right',
                                       f'Repeated gaze shift ({gaze_dir})',
                                       0.9, 'suspicious', roll, video_ts,
                                       bstatus=new_state)
                            gh.clear()
                    elif rk in self.gaze_history:
                        self.gaze_history[rk].clear()

                    if ear < self.EAR_LOW_THRESHOLD:
                        self._emit(alerts, 'eyes_closed',
                                   'Eyes appear closed or averted',
                                   0.75, 'warning', roll, video_ts,
                                   bstatus=new_state)

                    if idx == 0 and pose_res.pose_landmarks:
                        lm_p  = pose_res.pose_landmarks.landmark
                        avg_y = (lm_p[11].y + lm_p[12].y) / 2.0
                        bh    = self.body_history.setdefault(rk, deque(maxlen=20))
                        bh.append(avg_y)
                        if len(bh) == 20:
                            vals = list(bh)
                            if (max(vals) - min(vals)) > 0.15:
                                self._emit(alerts, 'suspicious_body_movement',
                                           'Abnormal body movement detected',
                                           0.85, 'suspicious',
                                           roll if roll != 'Unknown' else None,
                                           video_ts, bstatus=new_state)
                                bh.clear()
            else:
                if self.face_missing_since is None:
                    self.face_missing_since = video_ts
                elif video_ts - self.face_missing_since >= self.FACE_MISSING_DEBOUNCE:
                    self._emit(alerts, 'face_missing',
                               'Face not visible in frame',
                               1.0, 'warning', None, video_ts)

            return alerts

        except Exception:
            logger.debug("Frame analysis error", exc_info=True)
            return []

    # ─────────────────────────────────────────────────────────────────────────
    # Head pose — 10-point EPNP
    # ─────────────────────────────────────────────────────────────────────────

    def _head_pose(self, face_lm, img_w, img_h):
        lm = face_lm.landmark
        img_pts = np.array(
            [(lm[i].x * img_w, lm[i].y * img_h) for i in self._LM_INDICES_10],
            dtype="double",
        )
        cam = np.array([
            [img_w, 0,     img_w / 2],
            [0,     img_w, img_h / 2],
            [0,     0,     1],
        ], dtype="double")
        ok, rvec, _ = cv2.solvePnP(
            self._MODEL_PTS_10, img_pts, cam, np.zeros((4, 1)),
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
    # Zone + state machine (video_ts-based)
    # ─────────────────────────────────────────────────────────────────────────

    def _zone_from_angles(self, rel_yaw, rel_pitch):
        ay, ap = abs(rel_yaw), abs(rel_pitch)
        if ay > self.REL_YAW_WARNING or ap > self.REL_PITCH_WARNING:
            return 'suspicious'
        if ay > self.REL_YAW_NORMAL or ap > self.REL_PITCH_NORMAL:
            return 'warning'
        return 'normal'

    def _zone_hybrid(self, features, rel_yaw, rel_pitch):
        if self.classifier.available:
            label, conf = self.classifier.predict(features)
            if label is not None and conf >= self.ML_CONFIDENCE_THRESHOLD:
                return label.lower(), True, conf
        return self._zone_from_angles(rel_yaw, rel_pitch), False, 0.0

    def _update_state(self, rk, zone, video_ts):
        current = self.behavior_state.get(rk, 'Normal')
        if zone == 'normal':
            self.abnormal_since.pop(rk, None)
            if rk not in self.normal_since:
                self.normal_since[rk] = video_ts
            if video_ts - self.normal_since[rk] >= self.RECOVERY_DURATION:
                return 'Normal'
            return current
        else:
            self.normal_since.pop(rk, None)
            if rk not in self.abnormal_since:
                self.abnormal_since[rk] = video_ts
            abn_dur = video_ts - self.abnormal_since[rk]
            if zone == 'suspicious' and abn_dur >= self.SUSPICIOUS_DURATION:
                target = 'Suspicious'
            elif abn_dur >= self.WARNING_DURATION:
                target = 'Warning'
            else:
                return current
            order = {'Normal': 0, 'Warning': 1, 'Suspicious': 2, 'Critical': 3}
            return target if order.get(target, 0) > order.get(current, 0) else current

    def _head_dir(self, rel_yaw, rel_pitch):
        ay, ap = abs(rel_yaw), abs(rel_pitch)
        if ap >= self.REL_PITCH_NORMAL:
            return 'Down' if rel_pitch < 0 else 'Up'
        if ay >= self.REL_YAW_NORMAL:
            return 'Left' if rel_yaw < 0 else 'Right'
        return 'Center'

    # ─────────────────────────────────────────────────────────────────────────
    # Helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _load_faces(self):
        try:
            from api.models import FaceEmbedding
            embs = FaceEmbedding.objects.select_related('student').all()
            self.known_encodings = [np.array(e.embedding_data) for e in embs]
            self.known_names     = [e.student.roll_number for e in embs]
        except Exception:
            pass

    def _match_face(self, face_enc) -> str:
        if not self.known_encodings:
            return 'Unknown'
        dists = face_recognition.face_distance(self.known_encodings, face_enc)
        best  = int(np.argmin(dists))
        return self.known_names[best] if dists[best] < 0.55 else 'Unknown'

    def _emit(self, alert_list, a_type, msg, conf, severity, roll,
              video_ts, bstatus='Normal'):
        key      = f'{a_type}:{roll or "global"}'
        cooldown = self.ALERT_COOLDOWN.get(severity, 30)
        if video_ts - self.alert_last_vts.get(key, -9999) >= cooldown:
            alert_list.append({
                'type':             a_type,
                'message':          msg,
                'confidence':       float(conf),
                'severity':         severity,
                'student_roll':     roll,
                'behaviour_status': bstatus,
            })
            self.alert_last_vts[key] = video_ts

    @staticmethod
    def _frame_skip(duration_sec: float) -> int:
        if duration_sec < 300:
            return 5    # < 5 min
        if duration_sec < 1800:
            return 10   # 5–30 min
        return 20       # > 30 min

    def _make_evidence_files(self, frame, video_ts, frame_num, alert_dict):
        """Annotate frame and return (original_file, overlay_file)."""
        try:
            # 1. Original
            ret_orig, buf_orig = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            orig_file = None
            if ret_orig:
                fname_orig = f"vid{self.video_id}_f{frame_num}_orig.jpg"
                orig_file = ContentFile(buf_orig.tobytes(), name=fname_orig)

            # 2. Overlay
            ann = frame.copy()
            sev = alert_dict['severity']
            color = (0, 0, 220) if sev == 'critical' else (0, 80, 240)

            ts_str = f"{int(video_ts // 60):02d}:{video_ts % 60:05.2f}"
            cv2.rectangle(ann, (0, 0), (ann.shape[1], 70), (0, 0, 0), -1)
            cv2.putText(ann,
                        f"{alert_dict['type'].replace('_', ' ').title()}",
                        (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
            cv2.putText(ann,
                        f"t={ts_str}  conf={alert_dict['confidence']:.0%}  sev={sev.upper()}",
                        (10, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

            ret_ov, buf_ov = cv2.imencode('.jpg', ann, [cv2.IMWRITE_JPEG_QUALITY, 82])
            overlay_file = None
            if ret_ov:
                fname_ov = f"vid{self.video_id}_f{frame_num}_ov.jpg"
                overlay_file = ContentFile(buf_ov.tobytes(), name=fname_ov)

            return orig_file, overlay_file
        except Exception:
            logger.debug("Evidence frame creation failed", exc_info=True)
            return None, None
