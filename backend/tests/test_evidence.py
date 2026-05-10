from django.test import TestCase
from api.models import Alert, EvidenceLog, ExamSession
from django.core.files.uploadedfile import SimpleUploadedFile

class EvidenceLogTest(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(
            title="Midterm OS",
            start_time="2026-05-10T10:00:00Z",
            end_time="2026-05-10T12:00:00Z"
        )
        self.alert = Alert.objects.create(
            session=self.session,
            alert_type="face_missing",
            severity="suspicious"
        )
        # Create a dummy image
        image_content = b'\x47\x49\x46\x38\x39\x61\x01\x00\x01\x00\x00\x00\x00\x21\xf9\x04\x01\x0a\x00\x01\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x4c\x01\x00\x3b'
        self.image = SimpleUploadedFile("test_evidence.gif", image_content, content_type="image/gif")
        self.evidence = EvidenceLog.objects.create(
            alert=self.alert,
            screenshot=self.image
        )

    def test_evidence_creation(self):
        self.assertEqual(self.evidence.alert, self.alert)
        self.assertTrue(self.evidence.screenshot.name.startswith("evidence_screenshots/test_evidence"))

    def test_evidence_string_representation(self):
        self.assertEqual(str(self.evidence), "Evidence for face_missing")
