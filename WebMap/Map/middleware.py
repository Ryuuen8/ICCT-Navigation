# middleware.py
from django.http import JsonResponse
from django.conf import settings

class APIProtectionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/'):

            # 1. IP whitelist (if your frontend has a fixed IP)
            client_ip = request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
            if settings.ALLOWED_API_IPS and client_ip not in settings.ALLOWED_API_IPS:
                return JsonResponse({'error': 'Forbidden'}, status=403)

            # 2. API key check
            key = request.headers.get('X-Api-Key')
            if key != settings.API_SECRET_KEY:
                return JsonResponse({'error': 'Unauthorized'}, status=401)

        return self.get_response(request)