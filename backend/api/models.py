from django.db import models
from django.contrib.auth.models import User

class Student(models.Model):
    name = models.CharField(max_length=100)
    roll_number = models.CharField(max_length=20, unique=True)
    email = models.EmailField(unique=True)
    face_image = models.ImageField(upload_to='student_faces/')
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.roll_number})"

class FaceEmbedding(models.Model):
    student = models.OneToOneField(Student, on_delete=models.CASCADE, related_name='embedding')
    embedding_data = models.JSONField() # Store list of floats

class ExamSession(models.Model):
    title = models.CharField(max_length=200)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    is_active = models.BooleanField(default=False)

    def __str__(self):
        return self.title

class Alert(models.Model):
    SEVERITY_LEVELS = [
        ('warning', 'Warning'),
        ('suspicious', 'Suspicious'),
        ('critical', 'Critical'),
    ]
    ALERT_TYPES = [
        ('suspicious_head_movement',  'Suspicious Head Movement'),
        ('looking_left_right',        'Looking Left/Right'),
        ('face_missing',              'Face Missing'),
        ('multiple_faces',            'Multiple Faces'),
        ('suspicious_body_movement',  'Suspicious Body Movement'),   # Bug 1 fix
        ('abnormal_body_movement',    'Abnormal Body Movement'),     # kept for migration compat
        ('unknown_person',            'Unknown Person Detected'),
    ]
    
    session = models.ForeignKey(ExamSession, on_delete=models.CASCADE, related_name='alerts')
    student = models.ForeignKey(Student, on_delete=models.SET_NULL, null=True, blank=True)
    alert_type = models.CharField(max_length=50, choices=ALERT_TYPES, db_index=True)
    severity = models.CharField(max_length=20, choices=SEVERITY_LEVELS, default='warning', db_index=True)
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    confidence_score = models.FloatField(default=0.0)
    metadata = models.JSONField(default=dict, blank=True) # Store pose angles, coordinates, etc.

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.alert_type} ({self.severity}) at {self.timestamp}"

class BehaviourLog(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='behaviour_logs')
    session = models.ForeignKey(ExamSession, on_delete=models.CASCADE)
    status = models.CharField(max_length=20, default='Normal', db_index=True) # Normal, Suspicious, Critical
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    head_pose = models.JSONField(null=True) # {pitch, yaw, roll}
    gaze_direction = models.CharField(max_length=50, null=True)
    
class EvidenceLog(models.Model):
    alert = models.OneToOneField(Alert, on_delete=models.CASCADE, related_name='evidence')
    screenshot = models.ImageField(upload_to='evidence_screenshots/')
    annotated_image = models.ImageField(upload_to='evidence_annotated/', null=True, blank=True)
    captured_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Evidence for {self.alert.alert_type}"


# ── Video Upload Analysis ─────────────────────────────────────────────────────

class UploadedVideo(models.Model):
    STATUS_CHOICES = [
        ('pending',    'Pending'),
        ('processing', 'Processing'),
        ('completed',  'Completed'),
        ('failed',     'Failed'),
    ]
    title          = models.CharField(max_length=200)
    video_file     = models.FileField(upload_to='uploaded_videos/')
    uploaded_by    = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    uploaded_at    = models.DateTimeField(auto_now_add=True)
    duration       = models.FloatField(null=True, blank=True)   # seconds
    fps            = models.FloatField(null=True, blank=True)
    resolution     = models.CharField(max_length=50, null=True, blank=True)
    total_frames   = models.IntegerField(null=True, blank=True)
    status         = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    progress       = models.FloatField(default=0.0)             # 0–100
    processed_at   = models.DateTimeField(null=True, blank=True)
    error_message  = models.TextField(null=True, blank=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.title


class VideoAnalysisResult(models.Model):
    uploaded_video    = models.OneToOneField(UploadedVideo, on_delete=models.CASCADE, related_name='analysis_result')
    total_frames      = models.IntegerField(default=0)
    processed_frames  = models.IntegerField(default=0)
    total_alerts      = models.IntegerField(default=0)
    normal_count      = models.IntegerField(default=0)
    warning_count     = models.IntegerField(default=0)
    suspicious_count  = models.IntegerField(default=0)
    critical_count    = models.IntegerField(default=0)
    average_confidence = models.FloatField(default=0.0)
    processing_time   = models.FloatField(default=0.0)          # wall-clock seconds

    def __str__(self):
        return f"Results for {self.uploaded_video.title}"


class VideoAlert(models.Model):
    SEVERITY_LEVELS = [
        ('warning',    'Warning'),
        ('suspicious', 'Suspicious'),
        ('critical',   'Critical'),
    ]
    uploaded_video     = models.ForeignKey(UploadedVideo, on_delete=models.CASCADE, related_name='video_alerts')
    alert_type         = models.CharField(max_length=50)
    severity           = models.CharField(max_length=20, choices=SEVERITY_LEVELS, default='warning', db_index=True)
    timestamp_in_video = models.FloatField(db_index=True)       # seconds
    frame_number       = models.IntegerField()
    confidence_score   = models.FloatField(default=0.0)
    reason             = models.TextField()
    behaviour_status   = models.CharField(max_length=20, default='Normal')
    evidence_image     = models.ImageField(upload_to='video_evidence/', null=True, blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp_in_video']

    def __str__(self):
        return f"{self.alert_type} at {self.timestamp_in_video:.1f}s"


class VideoEvidenceFrame(models.Model):
    uploaded_video     = models.ForeignKey(UploadedVideo, on_delete=models.CASCADE, related_name='evidence_frames')
    alert              = models.OneToOneField(VideoAlert, on_delete=models.CASCADE, related_name='evidence_frame', null=True, blank=True)
    frame_number       = models.IntegerField()
    timestamp_in_video = models.FloatField()
    image              = models.ImageField(upload_to='video_evidence/original/')
    overlay_image      = models.ImageField(upload_to='video_evidence/annotated/', null=True, blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Evidence for {self.alert.alert_type} at {self.timestamp_in_video:.1f}s"
