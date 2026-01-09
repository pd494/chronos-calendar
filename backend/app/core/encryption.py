import os
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.config import get_settings

SALT_LENGTH = 16
IV_LENGTH = 12
KEY_LENGTH = 32

settings = get_settings()

def _derive_key(user_id: str, salt: bytes) -> bytes:
    master_key = settings.ENCRYPTION_MASTER_KEY.encode()
    key_material = master_key + user_id.encode()
    return hashlib.pbkdf2_hmac('sha256', key_material, salt, 100000, dklen=KEY_LENGTH)

def encrypt(plaintext: str, user_id: str) -> str:
    salt = os.urandom(SALT_LENGTH)
    iv = os.urandom(IV_LENGTH)
    key = _derive_key(user_id, salt)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode(), None)
    combined = salt + iv + ciphertext
    return base64.b64encode(combined).decode()

def decrypt(encrypted_data: str, user_id: str) -> str:
    combined = base64.b64decode(encrypted_data)
    salt = combined[:SALT_LENGTH]
    iv = combined[SALT_LENGTH:SALT_LENGTH + IV_LENGTH]
    ciphertext = combined[SALT_LENGTH + IV_LENGTH:]
    key = _derive_key(user_id, salt)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return plaintext.decode()

