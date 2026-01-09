import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.routers import auth, todos, events, google, settings as settings_router, chat

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)

app_settings = get_settings()

app = FastAPI(title="Chronos Calendar API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        app_settings.FRONTEND_URL,
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(todos.router, prefix="/todos", tags=["todos"])
app.include_router(events.router, prefix="/events", tags=["events"])
app.include_router(google.router, prefix="/google", tags=["google"])
app.include_router(settings_router.router, prefix="/settings", tags=["settings"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])

@app.get("/")
async def root():
    return {"message": "Chronos Calendar API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
