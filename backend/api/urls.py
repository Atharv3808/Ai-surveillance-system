from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    StudentViewSet, ExamSessionViewSet, AlertViewSet,
    EvidenceLogViewSet, UploadedVideoViewSet,
)

router = DefaultRouter()
router.register(r'students', StudentViewSet)
router.register(r'sessions', ExamSessionViewSet)
router.register(r'alerts',   AlertViewSet)
router.register(r'evidence', EvidenceLogViewSet)
router.register(r'videos',   UploadedVideoViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
