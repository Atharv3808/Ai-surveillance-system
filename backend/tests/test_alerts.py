from django.test import TestCase
from api.models import Alert, ExamSession, Student

class AlertModelTest(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(
            title="Midterm DB",
            start_time="2026-05-10T10:00:00Z",
            end_time="2026-05-10T12:00:00Z",
            is_active=True
        )
        self.student = Student.objects.create(
            name="Alice",
            roll_number="CS102",
            email="alice@example.com"
        )
        self.alert = Alert.objects.create(
            session=self.session,
            student=self.student,
            alert_type="multiple_faces",
            severity="critical",
            message="Multiple faces detected in frame.",
            confidence_score=0.95
        )

    def test_alert_creation(self):
        self.assertEqual(self.alert.alert_type, "multiple_faces")
        self.assertEqual(self.alert.severity, "critical")
        self.assertEqual(self.alert.session, self.session)
        self.assertEqual(self.alert.student, self.student)
        self.assertTrue("Multiple faces" in self.alert.message)

    def test_alert_string_representation(self):
        self.assertTrue(str(self.alert).startswith("multiple_faces (critical) at"))
