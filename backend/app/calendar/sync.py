import logging
import time
from datetime import datetime, timezone, timedelta

from app.calendar.google_client import fetch_events, GoogleAPIError
from app.calendar.helpers import (
    get_calendar_sync_state,
    update_calendar_sync_state,
    clear_calendar_sync_state,
    update_page_token,
    process_events,
    time_range_to_months,
    mark_months_synced,
)

logger = logging.getLogger(__name__)


async def range_fetch(
    user_id: str,
    google_account_id: str,
    google_calendar_id: str,
    google_calendar_external_id: str,
    time_min: str,
    time_max: str,
    resume_page_token: str = None
):
    logger.info(f"range_fetch starting: calendar={google_calendar_id}, ext_id={google_calendar_external_id}")
    logger.info(f"range_fetch params: time_min={time_min}, time_max={time_max}, resume_token={resume_page_token}")

    page_token = resume_page_token
    next_sync_token = None
    total_upserted = 0
    total_deleted = 0
    pages_fetched = 0

    while True:
        response = await fetch_events(
            user_id,
            google_account_id,
            google_calendar_external_id,
            time_min,
            time_max,
            page_token
        )
        pages_fetched += 1

        page_result = process_events(
            response.get("items", []),
            google_calendar_id,
            google_account_id,
            user_id
        )
        total_upserted += page_result["upserted"]
        total_deleted += page_result["deleted"]

        page_token = response.get("nextPageToken")
        if page_token:
            update_page_token(google_calendar_id, page_token)
        else:
            next_sync_token = response.get("nextSyncToken")
            update_page_token(google_calendar_id, None)
            break

    logger.info(f"range_fetch complete: calendar={google_calendar_id}, upserted={total_upserted}, deleted={total_deleted}")
    return {
        "upserted": total_upserted,
        "deleted": total_deleted,
        "next_sync_token": next_sync_token,
        "pages_fetched": pages_fetched
    }


async def delta_sync(
    user_id: str,
    google_account_id: str,
    google_calendar_id: str,
    google_calendar_external_id: str,
    sync_token: str,
    resume_page_token: str = None
):
    page_token = resume_page_token
    next_sync_token = None
    total_upserted = 0
    total_deleted = 0
    pages_fetched = 0

    try:
        while True:
            response = await fetch_events(
                user_id,
                google_account_id,
                google_calendar_external_id,
                sync_token=sync_token,
                page_token=page_token
            )
            pages_fetched += 1

            page_result = process_events(
                response.get("items", []),
                google_calendar_id,
                google_account_id,
                user_id
            )
            total_upserted += page_result["upserted"]
            total_deleted += page_result["deleted"]

            page_token = response.get("nextPageToken")
            if page_token:
                update_page_token(google_calendar_id, page_token)
            else:
                next_sync_token = response.get("nextSyncToken")
                update_page_token(google_calendar_id, None)
                break
    except GoogleAPIError as e:
        if e.status_code == 410:
            return {"sync_token_expired": True}
        raise

    return {
        "upserted": total_upserted,
        "deleted": total_deleted,
        "next_sync_token": next_sync_token,
        "pages_fetched": pages_fetched
    }


async def sync_single_calendar(
    google_calendar_id: str,
    google_calendar_external_id: str,
    user_id: str,
    google_account_id: str,
    force_full: bool = False
) -> dict:
    start_time = time.time()

    sync_state = get_calendar_sync_state(google_calendar_id)
    has_token = sync_state and sync_state.get("sync_token")
    resume_page_token = sync_state.get("next_page_token") if sync_state else None

    if force_full or not has_token:
        time_min = (datetime.now(timezone.utc) - timedelta(days=180)).isoformat()
        time_max = (datetime.now(timezone.utc) + timedelta(days=180)).isoformat()

        result = await range_fetch(
            user_id=user_id,
            google_account_id=google_account_id,
            google_calendar_id=google_calendar_id,
            google_calendar_external_id=google_calendar_external_id,
            time_min=time_min,
            time_max=time_max,
            resume_page_token=resume_page_token
        )

        months_fetched = time_range_to_months(time_min, time_max)
        mark_months_synced(google_calendar_id, months_fetched)

        sync_type = "full"
    else:
        result = await delta_sync(
            user_id=user_id,
            google_account_id=google_account_id,
            google_calendar_id=google_calendar_id,
            google_calendar_external_id=google_calendar_external_id,
            sync_token=sync_state["sync_token"],
            resume_page_token=resume_page_token
        )

        if result.get("sync_token_expired"):
            clear_calendar_sync_state(google_calendar_id)
            return await sync_single_calendar(
                google_calendar_id,
                google_calendar_external_id,
                user_id,
                google_account_id,
                force_full=True
            )

        sync_type = "incremental"

    sync_duration_ms = int((time.time() - start_time) * 1000)

    if result.get("next_sync_token"):
        update_calendar_sync_state(
            google_calendar_id,
            result["next_sync_token"],
            pages_fetched=result.get("pages_fetched"),
            items_upserted=result["upserted"],
            sync_duration_ms=sync_duration_ms
        )

    return {
        "status": "success",
        "upserted": result["upserted"],
        "deleted": result["deleted"],
        "sync_type": sync_type
    }
