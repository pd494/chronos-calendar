"""Encryption tests."""
import base64
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.encryption import Encryption


def test_encryption_roundtrip():
    """Basic, empty, unicode, different ciphertext each time."""
    user_id = "user-123"

    plaintext = "Hello, World!"
    encrypted = Encryption.encrypt(plaintext, user_id)
    assert Encryption.decrypt(encrypted, user_id) == plaintext

    empty = ""
    encrypted_empty = Encryption.encrypt(empty, user_id)
    assert Encryption.decrypt(encrypted_empty, user_id) == empty

    unicode_text = "Hello 世界 😀"
    encrypted_unicode = Encryption.encrypt(unicode_text, user_id)
    assert Encryption.decrypt(encrypted_unicode, user_id) == unicode_text

    enc1 = Encryption.encrypt("same", user_id)
    enc2 = Encryption.encrypt("same", user_id)
    assert enc1 != enc2
    assert Encryption.decrypt(enc1, user_id) == "same"
    assert Encryption.decrypt(enc2, user_id) == "same"


def test_encryption_errors():
    """Wrong user_id, corrupted, invalid base64, truncated."""
    user_id = "user-123"
    encrypted = Encryption.encrypt("secret", user_id)

    with pytest.raises(Exception):
        Encryption.decrypt(encrypted, "wrong-user")

    corrupted = base64.b64encode(os.urandom(50)).decode()
    with pytest.raises(Exception):
        Encryption.decrypt(corrupted, user_id)

    with pytest.raises(Exception):
        Encryption.decrypt("not-valid-base64!!!", user_id)

    truncated = base64.b64encode(os.urandom(10)).decode()
    with pytest.raises(Exception):
        Encryption.decrypt(truncated, user_id)


def test_batch_encrypt_decrypt_roundtrip():
    """batch_encrypt/batch_decrypt round-trips, None passes through."""
    user_id = "user-456"
    fields = {"summary": "Meeting", "description": "Notes", "location": None}

    encrypted = Encryption.batch_encrypt(fields, user_id)
    assert isinstance(encrypted["summary"], str) and encrypted["summary"] != "Meeting"
    assert isinstance(encrypted["description"], str) and encrypted["description"] != "Notes"
    assert encrypted["location"] is None

    decrypted = Encryption.batch_decrypt(encrypted, user_id)
    assert decrypted == {"summary": "Meeting", "description": "Notes", "location": None}


def test_pre_derived_key_matches_on_the_fly():
    """Pre-derived key produces same results as on-the-fly derivation."""
    user_id = "user-789"
    text = "cross-path test"

    key = Encryption.derive_key(user_id)
    encrypted_with_key = Encryption.encrypt(text, user_id, key=key)
    assert Encryption.decrypt(encrypted_with_key, user_id) == text

    encrypted_without_key = Encryption.encrypt(text, user_id)
    assert Encryption.decrypt(encrypted_without_key, user_id, key=key) == text


def test_different_users_different_ciphertext():
    """Different user_ids produce different keys; cross-user decrypt fails."""
    text = "shared secret"
    user_a = "user-aaa"
    user_b = "user-bbb"

    enc_a = Encryption.encrypt(text, user_a)
    enc_b = Encryption.encrypt(text, user_b)
    assert enc_a != enc_b

    assert Encryption.decrypt(enc_a, user_a) == text
    assert Encryption.decrypt(enc_b, user_b) == text

    with pytest.raises(Exception):
        Encryption.decrypt(enc_a, user_b)
    with pytest.raises(Exception):
        Encryption.decrypt(enc_b, user_a)
