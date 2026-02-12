import base64
import binascii
import logging
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import get_settings

logger = logging.getLogger(__name__)


class Encryption:
    IV_LENGTH = 12
    KEY_LENGTH = 32
    AAD_PREFIX = b"chronos-v1:"
    HKDF_SALT = b"chronos-hkdf-v1!"

    @staticmethod
    def derive_key(user_id: str) -> bytes:
        settings = get_settings()
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=Encryption.KEY_LENGTH,
            salt=Encryption.HKDF_SALT,
            info=user_id.encode(),
        )
        return hkdf.derive(settings.ENCRYPTION_MASTER_KEY.encode())

    @staticmethod
    def _build_aad(user_id: str) -> bytes:
        return Encryption.AAD_PREFIX + user_id.encode()

    @staticmethod
    def encrypt(plaintext: str, user_id: str, key: bytes | None = None) -> str:
        if key is None:
            key = Encryption.derive_key(user_id)
        iv = os.urandom(Encryption.IV_LENGTH)
        aad = Encryption._build_aad(user_id)
        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(iv, plaintext.encode(), aad)
        return base64.b64encode(iv + ciphertext).decode()

    @staticmethod
    def decrypt(encrypted_data: str, user_id: str, key: bytes | None = None) -> str:
        try:
            if key is None:
                key = Encryption.derive_key(user_id)
            combined = base64.b64decode(encrypted_data)
            iv = combined[:Encryption.IV_LENGTH]
            ciphertext = combined[Encryption.IV_LENGTH:]
            aad = Encryption._build_aad(user_id)
            aesgcm = AESGCM(key)
            plaintext = aesgcm.decrypt(iv, ciphertext, aad)
            return plaintext.decode()
        except (binascii.Error, InvalidTag, UnicodeDecodeError, IndexError) as e:
            logger.debug("Decryption failed: %s", type(e).__name__)
            raise ValueError("Decryption failed")
