from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from api.models import Student, FaceEmbedding
from django.core.files.uploadedfile import SimpleUploadedFile
import os

class StudentRegistrationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_superuser('admin_test', 'test@example.com', 'password123')
        self.client.force_authenticate(user=self.user)
        
        # Create a dummy image for testing
        self.image_path = 'test_face.jpg'
        with open(self.image_path, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2e\x44\x00\x00\x00\x00IEND\xaeB`\x82')

    def tearDown(self):
        if os.path.exists(self.image_path):
            os.remove(self.image_path)
        # Cleanup uploaded test files
        for student in Student.objects.all():
            if student.face_image:
                if os.path.exists(student.face_image.path):
                    os.remove(student.face_image.path)

    def test_student_registration_no_face(self):
        """Test registration with an image that has no face (should fail)"""
        url = reverse('student-list')
        with open(self.image_path, 'rb') as f:
            image_file = SimpleUploadedFile('test_face.jpg', f.read(), content_type='image/jpeg')
            data = {
                'name': 'Test Student',
                'roll_number': 'TEST001',
                'email': 'test@student.com',
                'face_image': image_file
            }
            response = self.client.post(url, data, format='multipart')
            
        # Since our dummy image has no face, it should return 400
        self.assertEqual(response.status_code, 400)
        self.assertIn('face_image', response.data)
        self.assertEqual(Student.objects.count(), 0)
