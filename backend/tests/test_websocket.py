from django.test import TestCase
from channels.testing import WebsocketCommunicator
from surveillance_backend.asgi import application
from api.models import ExamSession
import json

class WebSocketTests(TestCase):
    async def test_websocket_connection(self):
        # Create an active session to connect to
        session = await ExamSession.objects.acreate(
            title="WS Test Session",
            start_time="2026-05-10T10:00:00Z",
            end_time="2026-05-10T12:00:00Z",
            is_active=True
        )
        
        communicator = WebsocketCommunicator(application, f"/ws/monitoring/{session.id}/")
        connected, subprotocol = await communicator.connect()
        self.assertTrue(connected)
        
        # We won't test frame processing here as it requires a valid base64 image and heavy AI models.
        # Just verify connection and disconnection works.
        await communicator.disconnect()
