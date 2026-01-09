import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, verify_calendar_access_dep, verify_account_access_dep
from app.core.exceptions import handle_google_api_error, handle_unexpected_error
from app.calendar.helpers import (
    get_calendars_for_account,
    get_calendar_sync_state,
    get_google_accounts_for_user,
    get_all_calendars_for_user,
    get_synced_months,
    time_range_to_months,
    mark_months_synced,
)
from app.calendar.google_client import list_calendars, GoogleAPIError
from app.calendar.sync import range_fetch, sync_single_calendar
from app.chat.embedding import process_embedding_queue, get_user_ai_preference

logger = logging.getLogger(__name__)
router = APIRouter()


class RangeSyncRequest(BaseModel):
    time_min: str
    time_max: str


class BatchRangeSyncRequest(BaseModel):
    calendar_ids: list[str]
    time_min: str
    time_max: str


class SyncResponse(BaseModel):
    status: str
    upserted: int
    deleted: int
    sync_type: str | None = None


class SyncStatusResponse(BaseModel):
    calendar_id: str
    has_sync_token: bool


class AccountSyncResponse(BaseModel):
    calendars: list[dict]


@router.get("/calendars/{calendar_id}/status", response_model=SyncStatusResponse)
async def get_calendar_sync_status(
    calendar_id: str,
    current_user: CurrentUser
):
    calendar, google_account = verify_calendar_access_dep(calendar_id, current_user)

    sync_state = get_calendar_sync_state(calendar_id)

    return {
        "calendar_id": calendar_id,
        "has_sync_token": bool(sync_state and sync_state.get("sync_token"))
    }


@router.post("/calendars/{calendar_id}/sync", response_model=SyncResponse)
async def sync_calendar(
    calendar_id: str,
    background_tasks: BackgroundTasks,
    force_full: bool = False,
    current_user: CurrentUser = None
):
    calendar, google_account = verify_calendar_access_dep(calendar_id, current_user)

    try:
        result = await sync_single_calendar(
            google_calendar_id=calendar_id,
            google_calendar_external_id=calendar["google_calendar_id"],
            user_id=current_user["id"],
            google_account_id=google_account["id"],
            force_full=force_full
        )

        if get_user_ai_preference(current_user["id"]):
            background_tasks.add_task(process_embedding_queue, current_user["id"])

        return result
    except GoogleAPIError as e:
        handle_google_api_error(e, "Sync")
    except Exception as e:
        logger.exception(f"Calendar sync failed for {calendar_id}: {e}")
        handle_unexpected_error("calendar sync")



@router.post("/accounts/{google_account_id}/sync-all", response_model=AccountSyncResponse)
async def sync_all_calendars_for_account(
    google_account_id: str,
    background_tasks: BackgroundTasks,
    force_full: bool = False,
    current_user: CurrentUser = None
):
    google_account = verify_account_access_dep(google_account_id, current_user)

    calendars = get_calendars_for_account(google_account_id)
    results = []

    for calendar in calendars:
        try:
            result = await sync_single_calendar(
                google_calendar_id=calendar["id"],
                google_calendar_external_id=calendar["google_calendar_id"],
                user_id=current_user["id"],
                google_account_id=google_account_id,
                force_full=force_full
            )
            results.append({"calendar_id": calendar["id"], **result})
        except GoogleAPIError as e:
            results.append({
                "calendar_id": calendar["id"],
                "status": "error",
                "error": e.message
            })
        except Exception:
            logger.exception("Error syncing calendar %s", calendar["id"])
            results.append({
                "calendar_id": calendar["id"],
                "status": "error",
                "error": "Unexpected error"
            })

    if get_user_ai_preference(current_user["id"]):
        background_tasks.add_task(process_embedding_queue, current_user["id"])

    return {"calendars": results}


@router.post("/calendars/{calendar_id}/fetch-range", response_model=SyncResponse)
async def fetch_calendar_date_range(
    calendar_id: str,
    body: RangeSyncRequest,
    current_user: CurrentUser = None
):
    logger.info(f"fetch-range called for calendar {calendar_id}, range: {body.time_min} to {body.time_max}")
    calendar, google_account = verify_calendar_access_dep(calendar_id, current_user)
    logger.debug(f"Calendar: {calendar['google_calendar_id']}, Account: {google_account['id']}")

    sync_state = get_calendar_sync_state(calendar_id)
    resume_page_token = sync_state.get("next_page_token") if sync_state else None

    try:
        result = await range_fetch(
            user_id=current_user["id"],
            google_account_id=google_account["id"],
            google_calendar_id=calendar_id,
            google_calendar_external_id=calendar["google_calendar_id"],
            time_min=body.time_min,
            time_max=body.time_max,
            resume_page_token=resume_page_token
        )

        months_fetched = time_range_to_months(body.time_min, body.time_max)
        mark_months_synced(calendar_id, months_fetched)
        logger.info(f"fetch-range success for {calendar_id}: upserted={result['upserted']}, deleted={result['deleted']}")

        return {
            "status": "success",
            "upserted": result["upserted"],
            "deleted": result["deleted"],
            "sync_type": "range"
        }
    except GoogleAPIError as e:
        logger.error(f"GoogleAPIError in fetch-range for {calendar_id}: {e.status_code} - {e.message}")
        handle_google_api_error(e, "Sync")
    except Exception as e:
        logger.exception(f"Range sync failed for calendar {calendar_id}: {type(e).__name__}: {e}")
        handle_unexpected_error("range sync")


@router.get("/synced-months")
async def get_synced_months_for_user(current_user: CurrentUser):
    calendars = get_all_calendars_for_user(current_user["id"])

    result = {}
    for cal in calendars:
        months = get_synced_months(cal["id"])
        result[cal["id"]] = [f"{year}-{month}" for year, month in months]

    return {"synced_months": result}


@router.get("/accounts")
async def list_google_accounts(
    current_user: CurrentUser
):
    accounts = get_google_accounts_for_user(current_user["id"])
    return {"accounts": accounts}


@router.get("/calendars")
async def list_google_calendars(
    current_user: CurrentUser
):
    calendars = get_all_calendars_for_user(current_user["id"])
    return {"calendars": calendars}


@router.post("/accounts/{google_account_id}/refresh-calendars")
async def refresh_calendars_from_google(
    google_account_id: str,
    current_user: CurrentUser
):
    """Fetch calendar list from Google API and store in database."""
    verify_account_access_dep(google_account_id, current_user)
    try:
        calendars = await list_calendars(current_user["id"], google_account_id)
        return {"calendars": calendars}
    except GoogleAPIError as e:
        handle_google_api_error(e, "Refresh calendars")
    except Exception:
        handle_unexpected_error("refresh calendars")


@router.post("/process-embeddings")
async def trigger_embedding_processing(
    background_tasks: BackgroundTasks,
    current_user: CurrentUser
):
    if not get_user_ai_preference(current_user["id"]):
        raise HTTPException(status_code=403, detail="AI features not enabled")

    background_tasks.add_task(process_embedding_queue, current_user["id"])
    return {"status": "started", "user_id": current_user["id"]}
