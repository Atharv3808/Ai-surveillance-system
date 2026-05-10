from rest_framework import serializers
from django.contrib.auth.models import User
from .models import (
    Student, ExamSession, Alert, EvidenceLog, FaceEmbedding,
    UploadedVideo, VideoAnalysisResult, VideoAlert, VideoEvidenceFrame
)

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username', 'email')

class StudentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = '__all__'

class ExamSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamSession
        fields = '__all__'

class EvidenceLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = EvidenceLog
        fields = '__all__'

class AlertSerializer(serializers.ModelSerializer):
    evidence = EvidenceLogSerializer(read_only=True)
    student_name = serializers.ReadOnlyField(source='student.name')
    
    class Meta:
        model = Alert
        fields = '__all__'

class FaceEmbeddingSerializer(serializers.ModelSerializer):
    class Meta:
        model = FaceEmbedding
        fields = '__all__'


class VideoEvidenceFrameSerializer(serializers.ModelSerializer):
    class Meta:
        model = VideoEvidenceFrame
        fields = '__all__'


class VideoAlertSerializer(serializers.ModelSerializer):
    evidence_frame = VideoEvidenceFrameSerializer(read_only=True)

    class Meta:
        model = VideoAlert
        fields = '__all__'


class VideoAnalysisResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = VideoAnalysisResult
        fields = '__all__'


class UploadedVideoSerializer(serializers.ModelSerializer):
    analysis_result = VideoAnalysisResultSerializer(read_only=True)

    class Meta:
        model = UploadedVideo
        fields = '__all__'
        read_only_fields = ('uploaded_by', 'uploaded_at', 'status', 'progress',
                            'processed_at', 'error_message', 'fps', 'duration',
                            'resolution', 'total_frames')
