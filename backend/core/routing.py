from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/monitoring/(?P<session_id>\w+)/$', consumers.MonitoringConsumer.as_asgi()),
]
