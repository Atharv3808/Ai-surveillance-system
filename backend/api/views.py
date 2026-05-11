from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Student, ExamSession, Alert, EvidenceLog, FaceEmbedding, UploadedVideo, VideoAnalysisResult, VideoAlert
from .serializers import (
    StudentSerializer, ExamSessionSerializer, AlertSerializer,
    EvidenceLogSerializer, UserSerializer,
    UploadedVideoSerializer, VideoAnalysisResultSerializer, VideoAlertSerializer,
)
import numpy as np
import io
import threading
import logging
from PIL import Image
from django.core.files.base import ContentFile

logger = logging.getLogger(__name__)

class StudentViewSet(viewsets.ModelViewSet):
    queryset = Student.objects.all()
    serializer_class = StudentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        import face_recognition
        import logging
        logger = logging.getLogger(__name__)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        face_image = request.FILES.get('face_image')
        if not face_image:
            return Response({"error": "Face image is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Temporary save to validate face
            temp_student = serializer.save()
            
            # Optimization: Resize image before processing for speed
            from PIL import Image
            import os
            
            img = Image.open(temp_student.face_image.path)
            # Resize if image is too large (max width 800px)
            if img.width > 800:
                output_size = (800, int((800 / img.width) * img.height))
                img = img.resize(output_size, Image.LANCZOS)
                img.save(temp_student.face_image.path, quality=85, optimize=True)
            
            image = face_recognition.load_image_file(temp_student.face_image.path)
            encodings = face_recognition.face_encodings(image)
            
            if not encodings:
                # No face detected, delete the record and image
                temp_student.delete()
                return Response({"face_image": ["No face detected in the image. Please upload a clear photo of your face."]}, status=status.HTTP_400_BAD_REQUEST)
            
            # Save embedding
            FaceEmbedding.objects.create(
                student=temp_student,
                embedding_data=encodings[0].tolist()
            )
            temp_student.is_verified = True
            temp_student.save()
            
            # Send confirmation email
            self.send_confirmation_email(temp_student)
            
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
            
        except Exception as e:
            logger.error(f"Error during student registration: {str(e)}")
            return Response({"error": f"An error occurred during registration: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def send_confirmation_email(self, student):
        from django.core.mail import send_mail
        from django.conf import settings
        
        subject = 'Registration Successful - Smart Examination Surveillance'
        message = f"""
        Dear {student.name},

        You have been successfully registered for the Smart Examination Surveillance System.
        Your facial data has been enrolled and your identity is now verified.

        Roll Number: {student.roll_number}
        Status: Verified

        Please ensure you carry your ID card during the examination.

        Best regards,
        Surveillance Team
        """
        try:
            send_mail(
                subject,
                message,
                settings.DEFAULT_FROM_EMAIL,
                [student.email],
                fail_silently=True,
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Failed to send email to {student.email}: {str(e)}")

class ExamSessionViewSet(viewsets.ModelViewSet):
    queryset = ExamSession.objects.all()
    serializer_class = ExamSessionSerializer
    permission_classes = [permissions.IsAuthenticated]

from django.db.models import Avg, Count
from django.utils import timezone
from datetime import timedelta

class AlertViewSet(viewsets.ModelViewSet):
    queryset = Alert.objects.all()
    serializer_class = AlertSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='dashboard-stats')
    def dashboard_stats(self, request):
        today = timezone.now().date()
        stats = {
            'totalStudents': Student.objects.count(),
            'activeSessions': ExamSession.objects.filter(is_active=True).count(),
            'alertsToday': Alert.objects.filter(timestamp__date=today).count(),
            'avgConfidence': min(1.0, round(float(
                Alert.objects.filter(timestamp__date=today)
                .aggregate(Avg('confidence_score'))['confidence_score__avg'] or 0.0
            ), 3)),
        }
        return Response(stats)

    @action(detail=False, methods=['get'], url_path='recent')
    def recent_alerts(self, request):
        alerts = Alert.objects.order_by('-timestamp')[:10]
        serializer = self.get_serializer(alerts, many=True)
        return Response(serializer.data)

class EvidenceLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = EvidenceLog.objects.all()
    serializer_class = EvidenceLogSerializer
    permission_classes = [permissions.IsAuthenticated]


# ── Video Upload Analysis ──────────────────────────────────────────────────────

def _run_processor(video_id: int):
    """Target function for background processing thread."""
    from core.video_processor import VideoProcessor
    VideoProcessor(video_id).process()


class UploadedVideoViewSet(viewsets.ModelViewSet):
    queryset            = UploadedVideo.objects.select_related('analysis_result').all()
    serializer_class    = UploadedVideoSerializer
    permission_classes  = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        instance = serializer.save(uploaded_by=self.request.user)
        # Extract metadata synchronously (fast — just reads file headers)
        try:
            import cv2
            cap = cv2.VideoCapture(instance.video_file.path)
            fps    = cap.get(cv2.CAP_PROP_FPS) or 25.0
            total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            w      = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h      = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()
            UploadedVideo.objects.filter(pk=instance.pk).update(
                fps=round(fps, 2),
                duration=round(total / fps, 1) if fps else None,
                resolution=f"{w}x{h}",
                total_frames=total,
            )
        except Exception:
            logger.warning("Could not read video metadata for %s", instance.pk)

    @action(detail=True, methods=['post'])
    def process(self, request, pk=None):
        video = self.get_object()
        if video.status == 'processing':
            return Response({'error': 'Video is already being processed.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if video.status == 'completed':
            return Response({'error': 'Already processed. Delete and re-upload to reprocess.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # For failed videos, wipe any partial records from the previous attempt so that
        # the processor can create fresh VideoAnalysisResult / VideoAlert rows.
        if video.status == 'failed':
            from .models import VideoAnalysisResult
            VideoAnalysisResult.objects.filter(uploaded_video=video).delete()
            video.video_alerts.all().delete()

        UploadedVideo.objects.filter(pk=video.pk).update(
            status='processing', progress=0.0, error_message=None
        )
        thread = threading.Thread(target=_run_processor, args=(video.pk,), daemon=True)
        thread.start()
        return Response({'status': 'processing', 'message': 'Video analysis started.'})

    @action(detail=True, methods=['get'], url_path='status')
    def video_status(self, request, pk=None):
        video = self.get_object()
        # Include current alerts count and progress
        alert_count = video.video_alerts.count()
        return Response({
            'id':            video.id,
            'status':        video.status,
            'progress':      video.progress,
            'alert_count':   alert_count,
            'error_message': video.error_message,
        })

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        video  = self.get_object()
        result = getattr(video, 'analysis_result', None)
        alerts = video.video_alerts.all()
        return Response({
            'video':   UploadedVideoSerializer(video, context={'request': request}).data,
            'summary': VideoAnalysisResultSerializer(result).data if result else None,
            'alerts':  VideoAlertSerializer(alerts, many=True, context={'request': request}).data,
        })

    @action(detail=False, methods=['get'], url_path='list-all')
    def list_all(self, request):
        videos = self.get_queryset()
        return Response(UploadedVideoSerializer(videos, many=True, context={'request': request}).data)
