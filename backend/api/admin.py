from django.contrib import admin
from .models import Student, ExamSession, Alert, EvidenceLog, FaceEmbedding, UploadedVideo, VideoAnalysisResult, VideoAlert, VideoEvidenceFrame

@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ('name', 'roll_number', 'email', 'is_verified', 'created_at')
    search_fields = ('name', 'roll_number', 'email')

@admin.register(ExamSession)
class ExamSessionAdmin(admin.ModelAdmin):
    list_display = ('title', 'start_time', 'end_time', 'is_active')
    list_filter = ('is_active',)

@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ('alert_type', 'severity', 'student', 'session', 'timestamp')
    list_filter = ('severity', 'alert_type', 'timestamp')

@admin.register(UploadedVideo)
class UploadedVideoAdmin(admin.ModelAdmin):
    list_display = ('title', 'status', 'progress', 'uploaded_at')
    list_filter = ('status', 'uploaded_at')

@admin.register(VideoAlert)
class VideoAlertAdmin(admin.ModelAdmin):
    list_display = ('alert_type', 'severity', 'uploaded_video', 'timestamp_in_video')
    list_filter = ('severity', 'alert_type')

admin.site.register(EvidenceLog)
admin.site.register(FaceEmbedding)
admin.site.register(VideoAnalysisResult)
admin.site.register(VideoEvidenceFrame)
