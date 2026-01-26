"""
Tests for encryption module.
"""
import base64
import hashlib
import os
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.encryption import Encryption


class TestEncryptionHappyPath:
    def test_encrypt_decrypt_roundtrip(self):
        plaintext = "Hello, World!"
        user_id = "user-123"

        encrypted = Encryption.encrypt(plaintext, user_id)
        decrypted = Encryption.decrypt(encrypted, user_id)

        assert decrypted == plaintext

    def test_encrypt_produces_different_ciphertext_each_time(self):
        plaintext = "Same text"
        user_id = "user-123"

        encrypted1 = Encryption.encrypt(plaintext, user_id)
        encrypted2 = Encryption.encrypt(plaintext, user_id)

        assert encrypted1 != encrypted2

        assert Encryption.decrypt(encrypted1, user_id) == plaintext
        assert Encryption.decrypt(encrypted2, user_id) == plaintext

    def test_encrypted_output_starts_with_v2_version_byte(self):
        plaintext = "Test data"
        user_id = "user-123"

        encrypted = Encryption.encrypt(plaintext, user_id)
        combined = base64.b64decode(encrypted)

        assert combined[0:1] == Encryption.VERSION_BYTE_V2

    def test_encrypt_empty_string(self):
        plaintext = ""
        user_id = "user-123"

        encrypted = Encryption.encrypt(plaintext, user_id)
        decrypted = Encryption.decrypt(encrypted, user_id)

        assert decrypted == plaintext

    def test_encrypt_unicode_content(self):
        plaintext = "Hello \u4e16\u754c \U0001f600"
        user_id = "user-123"

        encrypted = Encryption.encrypt(plaintext, user_id)
        decrypted = Encryption.decrypt(encrypted, user_id)

        assert decrypted == plaintext


class TestEncryptionErrorCases:
    def test_decrypt_with_wrong_user_id_raises_exception(self):
        plaintext = "Secret data"
        user_id = "user-123"
        wrong_user_id = "user-456"

        encrypted = Encryption.encrypt(plaintext, user_id)

        with pytest.raises(Exception):
            Encryption.decrypt(encrypted, wrong_user_id)

    def test_decrypt_corrupted_data_raises_exception(self):
        user_id = "user-123"
        corrupted = base64.b64encode(b"\x02" + os.urandom(50)).decode()

        with pytest.raises(Exception):
            Encryption.decrypt(corrupted, user_id)

    def test_decrypt_invalid_base64_raises_exception(self):
        user_id = "user-123"

        with pytest.raises(Exception):
            Encryption.decrypt("not-valid-base64!!!", user_id)

    def test_decrypt_truncated_data_raises_exception(self):
        user_id = "user-123"
        truncated = base64.b64encode(b"\x02" + os.urandom(10)).decode()

        with pytest.raises(Exception):
            Encryption.decrypt(truncated, user_id)


class TestV1BackwardCompatibility:
    def test_decrypt_v1_format_data(self):
        plaintext = "Legacy data"
        user_id = "user-123"

        from app.config import get_settings
        settings = get_settings()
        master_key = settings.ENCRYPTION_MASTER_KEY.encode()
        key_material = master_key + user_id.encode()

        salt = os.urandom(Encryption.SALT_LENGTH)
        iv = os.urandom(Encryption.IV_LENGTH)
        key = hashlib.pbkdf2_hmac(
            "sha256", key_material, salt, Encryption.PBKDF2_ITERATIONS_V1, dklen=Encryption.KEY_LENGTH
        )

        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(iv, plaintext.encode(), None)

        combined = salt + iv + ciphertext
        encrypted_v1 = base64.b64encode(combined).decode()

        decrypted = Encryption.decrypt(encrypted_v1, user_id)
        assert decrypted == plaintext

    def test_v1_data_does_not_have_version_byte(self):
        plaintext = "Legacy data"
        user_id = "user-123"

        from app.config import get_settings
        settings = get_settings()
        master_key = settings.ENCRYPTION_MASTER_KEY.encode()
        key_material = master_key + user_id.encode()

        salt = os.urandom(Encryption.SALT_LENGTH)
        iv = os.urandom(Encryption.IV_LENGTH)
        key = hashlib.pbkdf2_hmac(
            "sha256", key_material, salt, Encryption.PBKDF2_ITERATIONS_V1, dklen=Encryption.KEY_LENGTH
        )

        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(iv, plaintext.encode(), None)

        combined = salt + iv + ciphertext
        assert combined[0:1] != Encryption.VERSION_BYTE_V2
