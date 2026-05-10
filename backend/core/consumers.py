import json
import cv2
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .ai_engine import SurveillanceAI
from api.models import ExamSession, Alert, Student, EvidenceLog
from django.core.files.base import ContentFile
import time
import logging

logger = logging.getLogger(__name__)


def _on_save_done(task):
    if not task.cancelled() and task.exception() is not None:
        logger.error("Alert save task failed", exc_info=task.exception())


class MonitoringConsumer(AsyncWebsocketConsumer):
    ai_engine = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if MonitoringConsumer.ai_engine is None:
            MonitoringConsumer.ai_engine = SurveillanceAI()
        self.processing = False
        self.FRAME_SKIP = 1  # Rate-limited by self.processing flag; no extra skip needed

    async def connect(self):
        try:
            self.session_id = self.scope['url_route']['kwargs']['session_id']
            self.room_group_name = f'monitoring_{self.session_id}'

            session_exists = await self.check_session(self.session_id)
            if not session_exists:
                logger.warning(f"Connection attempt to non-existent/inactive session: {self.session_id}")
                await self.close(code=4001)
                return

            await self.initialize_ai_engine()

            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.accept()
            logger.info(f"WebSocket connected for session: {self.session_id}")

        except Exception:
            logger.error("Error during WebSocket connect", exc_info=True)
            await self.close()

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name') and self.channel_layer:
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        logger.info(f"WebSocket disconnected: {getattr(self, 'session_id', '?')}")

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Received invalid JSON: {e}")
            return

        frame_data = data.get('frame')
        if not frame_data or self.processing:
            return

        self.processing = True
        try:
            detections, alerts, frame = await asyncio.to_thread(
                MonitoringConsumer.ai_engine.process_frame, frame_data, self.session_id
            )

            # Encode frame to JPEG bytes here, in the async context, before spawning the
            # DB task — avoids passing a mutable numpy array across task boundaries.
            frame_bytes = None
            if frame is not None:
                h, w = frame.shape[:2]
                if w > 640:
                    frame = cv2.resize(frame, (640, int(640 * h / w)))
                ret, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                if ret:
                    frame_bytes = buf.tobytes()

            # Only persist suspicious/critical; warnings are too frequent and fill disk fast
            persist_alerts = [a for a in (alerts or []) if a.get('severity') in ('suspicious', 'critical')]
            if persist_alerts and frame_bytes is not None:
                task = asyncio.create_task(
                    self.save_alerts_async(persist_alerts, self.session_id, frame_bytes)
                )
                task.add_done_callback(_on_save_done)

            await self.send(text_data=json.dumps({
                'detections': detections or [],
                'alerts': alerts or [],
            }))

            # Broadcast critical alerts to other clients watching the same session.
            # Include sender channel name so the originating connection can skip it.
            if alerts and any(a.get('severity') == 'critical' for a in alerts):
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'broadcast_alert', 'alerts': alerts, 'sender': self.channel_name},
                )

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error("Error processing frame", exc_info=True)
        finally:
            self.processing = False

    async def broadcast_alert(self, event):
        # Skip re-delivering to the connection that originated this broadcast
        if event.get('sender') == self.channel_name:
            return
        await self.send(text_data=json.dumps({'broadcast_alerts': event['alerts']}))

    @database_sync_to_async
    def check_session(self, session_id):
        return ExamSession.objects.filter(id=session_id, is_active=True).exists()

    @database_sync_to_async
    def initialize_ai_engine(self):
        MonitoringConsumer.ai_engine.load_known_faces()

    @database_sync_to_async
    def save_alerts_async(self, alerts, session_id, frame_bytes):
        try:
            session = ExamSession.objects.get(id=session_id)
        except ExamSession.DoesNotExist:
            logger.error(f"Session {session_id} not found while saving alerts")
            return

        for a in alerts:
            student_roll = a.get('student_roll')
            student = None
            if student_roll and student_roll != 'Unknown':
                student = Student.objects.filter(roll_number=student_roll).first()

            # Collect pose/debug fields into metadata so analysts can audit later
            metadata = {}
            for key in ('rel_yaw', 'rel_pitch', 'smoothed_yaw', 'smoothed_pitch',
                        'baseline_yaw', 'baseline_pitch', 'raw_yaw', 'raw_pitch',
                        'zone', 'state', 'abnormal_s'):
                val = (a.get('_debug') or {}).get(key)
                if val is not None:
                    metadata[key] = val
            if a.get('head_direction'):
                metadata['head_direction'] = a['head_direction']
            if a.get('gaze'):
                metadata['gaze'] = a['gaze']

            try:
                alert_obj = Alert.objects.create(
                    session=session,
                    student=student,
                    alert_type=a['type'],
                    severity=a['severity'],
                    message=a['message'],
                    confidence_score=min(1.0, float(a.get('confidence', 0.0))),
                    metadata=metadata,
                )
                filename = f"alert_{alert_obj.id}_{int(time.time())}.jpg"
                EvidenceLog.objects.create(
                    alert=alert_obj,
                    screenshot=ContentFile(frame_bytes, name=filename),
                )
            except Exception:
                logger.error(f"Failed to persist alert {a.get('type')}", exc_info=True)
