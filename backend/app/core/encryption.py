import base64
import hashlib
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

logger = logging.getLogger(__name__)


class Encryption:
    SALT_LENGTH = 16
    IV_LENGTH = 12
    KEY_LENGTH = 32
    PBKDF2_ITERATIONS_V2 = 600000
    PBKDF2_ITERATIONS_V1 = 100000
    AAD_PREFIX = b"chronos-v1:"
    VERSION_BYTE_V2 = b'\x02'

    @staticmethod
    def _derive_key(user_id: str, salt: bytes, iterations: int) -> bytes:
        settings = get_settings()
        master_key = settings.ENCRYPTION_MASTER_KEY.encode()
        key_material = master_key + user_id.encode()
        return hashlib.pbkdf2_hmac(
            "sha256", key_material, salt, iterations, dklen=Encryption.KEY_LENGTH
        )

    @staticmethod
    def _build_aad(user_id: str) -> bytes:
        return Encryption.AAD_PREFIX + user_id.encode()

    @staticmethod
    def encrypt(plaintext: str, user_id: str) -> str:
        salt = os.urandom(Encryption.SALT_LENGTH)
        iv = os.urandom(Encryption.IV_LENGTH)
        key = Encryption._derive_key(user_id, salt, Encryption.PBKDF2_ITERATIONS_V2)
        aad = Encryption._build_aad(user_id)
        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(iv, plaintext.encode(), aad)
        combined = Encryption.VERSION_BYTE_V2 + salt + iv + ciphertext
        return base64.b64encode(combined).decode()

    @staticmethod
    def decrypt(encrypted_data: str, user_id: str) -> str:
        try:
            combined = base64.b64decode(encrypted_data)

            if combined[0:1] == Encryption.VERSION_BYTE_V2:
                salt = combined[1 : 1 + Encryption.SALT_LENGTH]
                iv = combined[1 + Encryption.SALT_LENGTH : 1 + Encryption.SALT_LENGTH + Encryption.IV_LENGTH]
                ciphertext = combined[1 + Encryption.SALT_LENGTH + Encryption.IV_LENGTH :]
                key = Encryption._derive_key(user_id, salt, Encryption.PBKDF2_ITERATIONS_V2)
                aad = Encryption._build_aad(user_id)
                aesgcm = AESGCM(key)
                plaintext = aesgcm.decrypt(iv, ciphertext, aad)
                return plaintext.decode()

            salt = combined[: Encryption.SALT_LENGTH]
            iv = combined[Encryption.SALT_LENGTH : Encryption.SALT_LENGTH + Encryption.IV_LENGTH]
            ciphertext = combined[Encryption.SALT_LENGTH + Encryption.IV_LENGTH :]
            key = Encryption._derive_key(user_id, salt, Encryption.PBKDF2_ITERATIONS_V1)
            aesgcm = AESGCM(key)
            plaintext = aesgcm.decrypt(iv, ciphertext, None)
            return plaintext.decode()
        except Exception as e:
            logger.debug("Decryption failed: %s", e)
            raise ValueError("Decryption failed")
