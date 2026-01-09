import re
import os
import hashlib
from functools import lru_cache
from fastembed import TextEmbedding
from app.core.encryption import decrypt
from app.core.supabase import get_supabase_client

MAX_DESCRIPTION_CHARS = 2000
MAX_ATTENDEES = 10


@lru_cache(maxsize=1)
def get_embedder() -> TextEmbedding:
    return TextEmbedding(
        model_name="BAAI/bge-small-en-v1.5",
        threads=max(1, os.cpu_count() // 2)
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_embedder()
    return [[float(x) for x in emb] for emb in model.embed(texts)]


def compute_embedding_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def prepare_event_for_embedding(event: dict, user_id: str) -> str:
    parts = []

    if title := event.get("title"):
        try:
            parts.append(f"Title: {decrypt(title, user_id)}")
        except Exception:
            pass

    if desc := event.get("description"):
        try:
            decrypted = decrypt(desc, user_id)
            decrypted = re.sub(r"\s+", " ", decrypted).strip()[:MAX_DESCRIPTION_CHARS]
            parts.append(f"Description: {decrypted}")
        except Exception:
            pass

    if loc := event.get("location"):
        try:
            parts.append(f"Location: {decrypt(loc, user_id)}")
        except Exception:
            pass

    if start := event.get("start_time"):
        parts.append(f"Start: {start}")
    if end := event.get("end_time"):
        parts.append(f"End: {end}")
    if event.get("is_all_day"):
        parts.append("All-day event")

    return " | ".join(filter(None, parts))


def get_user_ai_preference(user_id: str) -> bool:
    supabase = get_supabase_client()
    result = (
        supabase.table("users")
        .select("ai_features_enabled")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        return False
    return result.data.get("ai_features_enabled", False)


def get_user_google_account_ids(user_id: str) -> list[str]:
    supabase = get_supabase_client()
    result = (
        supabase.table("google_accounts")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    return [row["id"] for row in result.data]


def process_embedding_queue(user_id: str, batch_size: int = 50) -> int:
    supabase = get_supabase_client()
    processed = 0
    account_ids = get_user_google_account_ids(user_id)

    if not account_ids:
        return 0

    while True:
        result = (
            supabase.table("events")
            .select("id, title, description, location, start_time, end_time, is_all_day, embedding_text_hash")
            .eq("embedding_pending", True)
            .eq("source", "google")
            .in_("google_account_id", account_ids)
            .limit(batch_size)
            .execute()
        )

        if not result.data:
            break

        texts_to_embed = []
        events_to_update = []
        skip_ids = []

        for event in result.data:
            text = prepare_event_for_embedding(event, user_id)
            new_hash = compute_embedding_hash(text)

            if new_hash == event.get("embedding_text_hash"):
                skip_ids.append(event["id"])
                continue

            texts_to_embed.append(text)
            events_to_update.append({"id": event["id"], "hash": new_hash})

        if skip_ids:
            (
                supabase.table("events")
                .update({"embedding_pending": False})
                .in_("id", skip_ids)
                .execute()
            )

        if not texts_to_embed:
            continue

        embeddings = embed_texts(texts_to_embed)

        for event_info, embedding in zip(events_to_update, embeddings):
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

    return processed


def backfill_user_embeddings(user_id: str, force_all: bool = False) -> int:
    supabase = get_supabase_client()
    account_ids = get_user_google_account_ids(user_id)

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
