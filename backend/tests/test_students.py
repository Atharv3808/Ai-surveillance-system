from django.test import TestCase
from api.models import Student, FaceEmbedding

class StudentModelTest(TestCase):
    def setUp(self):
        self.student = Student.objects.create(
            name="John Doe",
            roll_number="CS101",
            email="john@example.com",
            is_verified=True
        )
        self.embedding = FaceEmbedding.objects.create(
            student=self.student,
            embedding_data=[0.1, 0.2, 0.3]
        )

    def test_student_creation(self):
        self.assertEqual(self.student.name, "John Doe")
        self.assertEqual(self.student.roll_number, "CS101")
        self.assertTrue(self.student.is_verified)
        self.assertEqual(str(self.student), "John Doe (CS101)")

    def test_face_embedding_relation(self):
        self.assertEqual(self.student.embedding.embedding_data, [0.1, 0.2, 0.3])
