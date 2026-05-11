import os
from .settings import *  # noqa: F401,F403

DEBUG = False

EC2_IP = os.environ.get('EC2_IP', '43.205.95.138')
EXTRA_HOSTS = os.environ.get('EXTRA_HOSTS', '').split(',')

ALLOWED_HOSTS = [
    EC2_IP,
    'localhost',
    '127.0.0.1',
    '43-205-95-138.nip.io',
] + [h for h in EXTRA_HOSTS if h]

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    f'https://{EC2_IP}',
    f'http://{EC2_IP}',
    'https://43-205-95-138.nip.io',
    'http://localhost:5173',
]
CORS_ALLOW_CREDENTIALS = True

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', SECRET_KEY)  # noqa: F405

SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

CSRF_TRUSTED_ORIGINS = [
    f'https://{EC2_IP}',
    'https://43-205-95-138.nip.io',
]
