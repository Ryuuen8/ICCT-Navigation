from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
from django.conf import settings

signer = TimestampSigner(key=settings.SECRET_KEY)

def generate_validate_token(data: str, max_age_seconds: int = 300) -> str:
    return signer.sign(data)

def validate_secure_token(token:str, max_age_seconds: int = 300) -> str:
    try:
        original_data = signer.unsign(token, max_age=max_age_seconds)
    except BadSignature:
        return False, "Invalid Token"
    except SignatureExpired:
        return False, "Link/Token Expired"