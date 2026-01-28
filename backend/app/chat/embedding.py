import hashlib
import logging
import os
import re
from functools import lru_cache
from html.parser import HTMLParser
from io import StringIO

from fastembed import TextEmbedding

from app.calendar.db import get_google_accounts_for_user
from app.core.db_utils import all_rows
from app.core.encryption import Encryption
from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)

MAX_DESCRIPTION_CHARS = 2000
MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIMENSIONS = 384


class HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.reset()
        self.strict = False
        self.convert_charrefs = True
        self.text = StringIO()

    def handle_data(self, data):
        self.text.write(data)

    def get_data(self):
        return self.text.getvalue()


def strip_html(html: str) -> str:
    if not html:
        return ""
    stripper = HTMLStripper()
    try:
        stripper.feed(html)
        return stripper.get_data()
    except Exception:
        return re.sub(r"<[^>]+>", "", html)


@lru_cache(maxsize=1)
def get_embedder() -> TextEmbedding:
    return TextEmbedding(
        model_name=MODEL_NAME,
        threads=max(1, (os.cpu_count() or 2) // 2)
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_embedder()
    return [[float(x) for x in emb] for emb in model.embed(texts)]


def generate_embedding(text: str) -> list[float] | None:
    if not text or not text.strip():
        return None
    try:
        embeddings = embed_texts([text])
        return embeddings[0] if embeddings else None
    except Exception as e:
        logger.error("Failed to generate embedding: %s", e)
        return None


def embed_event(event: dict, user_id: str) -> list[float] | None:
    if event.get("status") == "cancelled":
        return None
    text = prepare_event_for_embedding(event, user_id)
    return generate_embedding(text)


def compute_embedding_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def prepare_event_for_embedding(event: dict, user_id: str) -> str:
    parts = []

    if summary := event.get("summary"):
        try:
            parts.append(f"Title: {Encryption.decrypt(summary, user_id)}")
        except Exception as e:
            logger.debug("Failed to decrypt summary: %s", e)

    if desc := event.get("description"):
        try:
            decrypted = Encryption.decrypt(desc, user_id)
            decrypted = strip_html(decrypted)
            decrypted = re.sub(r"\s+", " ", decrypted).strip()[:MAX_DESCRIPTION_CHARS]
            parts.append(f"Description: {decrypted}")
        except Exception as e:
            logger.debug("Failed to decrypt description: %s", e)

    if loc := event.get("location"):
        try:
            parts.append(f"Location: {Encryption.decrypt(loc, user_id)}")
        except Exception as e:
            logger.debug("Failed to decrypt location: %s", e)

    start_dt = event.get("start_datetime") or {}
    if start := start_dt.get("dateTime") or start_dt.get("date"):
        parts.append(f"Start: {start}")

    end_dt = event.get("end_datetime") or {}
    if end := end_dt.get("dateTime") or end_dt.get("date"):
        parts.append(f"End: {end}")

    if event.get("is_all_day"):
        parts.append("All-day event")

    return " | ".join(filter(None, parts))


def process_embedding_queue(user_id: str, batch_size: int = 50) -> int:
    supabase = get_supabase_client()
    processed = 0
    accounts = get_google_accounts_for_user(supabase, user_id)
    account_ids = [str(acc["id"]) for acc in accounts if acc.get("id")]

    if not account_ids:
        return 0

    while True:
        result = (
            supabase.table("events")
            .select("id, summary, description, location, start_datetime, end_datetime, is_all_day, embedding_text_hash, status")
            .eq("embedding_pending", True)
            .eq("source", "google")
            .in_("google_account_id", account_ids)
            .limit(batch_size)
            .execute()
        )

        events = all_rows(result.data)
        if not events:
            break

        texts_to_embed = []
        events_to_update = []
        skip_ids = []
        empty_text_ids = []

        for event in events:
            if event.get("status") == "cancelled":
                skip_ids.append(event["id"])
                continue

            text = prepare_event_for_embedding(event, user_id)

            if not text or not text.strip():
                empty_text_ids.append(event["id"])
                continue

            new_hash = compute_embedding_hash(text)

            if new_hash == event.get("embedding_text_hash"):
                skip_ids.append(event["id"])
                continue

            texts_to_embed.append(text)
            events_to_update.append({"id": event["id"], "hash": new_hash, "text": text})

        if skip_ids:
            (
                supabase.table("events")
                .update({"embedding_pending": False})
                .in_("id", skip_ids)
                .execute()
            )

        if empty_text_ids:
            (
                supabase.table("events")
                .update({"embedding_pending": False, "embedding": None})
                .in_("id", empty_text_ids)
                .execute()
            )

        if not texts_to_embed:
            continue

        try:
            embeddings = embed_texts(texts_to_embed)
        except Exception as e:
            logger.error("Batch embedding failed, processing individually: %s", e)
            for event_info in events_to_update:
                embedding = generate_embedding(event_info["text"])
                if embedding:
                    (
                        supabase.table("events")
                        .update({
                            "embedding": embedding,
                            "embedding_text_hash": event_info["hash"],
                            "embedding_pending": False
                        })
                        .eq("id", event_info["id"])
                        .execute()
                    )
                    processed += 1
                else:
                    logger.warning("Failed to embed event %s, will retry later", event_info["id"])
            continue

        for event_info, embedding in zip(events_to_update, embeddings):
            try:
                (
                    supabase.table("events")
                    .update({
                        "embedding": embedding,
                        "embedding_text_hash": event_info["hash"],
                        "embedding_pending": False
                    })
                    .eq("id", event_info["id"])
                    .execute()
                )
                processed += 1
            except Exception as e:
                logger.error("Failed to save embedding for event %s: %s", event_info["id"], e)

    return processed


def backfill_user_embeddings(user_id: str, force_all: bool = False) -> int:
    supabase = get_supabase_client()
    accounts = get_google_accounts_for_user(supabase, user_id)
    account_ids = [str(acc["id"]) for acc in accounts if acc.get("id")]

    if not account_ids:
        return 0

    query = (
        supabase.table("events")
        .update({"embedding_pending": True})
        .eq("source", "google")
        .in_("google_account_id", account_ids)
    )

    if not force_all:
        query = query.is_("embedding", "null")

    query.execute()

    return process_embedding_queue(user_id)


class EmbeddingService:
    get_embedder = staticmethod(get_embedder)
    embed_texts = staticmethod(embed_texts)
    generate_embedding = staticmethod(generate_embedding)
    embed_event = staticmethod(embed_event)
    compute_embedding_hash = staticmethod(compute_embedding_hash)
    prepare_event_for_embedding = staticmethod(prepare_event_for_embedding)
    process_embedding_queue = staticmethod(process_embedding_queue)
    backfill_user_embeddings = staticmethod(backfill_user_embeddings)
