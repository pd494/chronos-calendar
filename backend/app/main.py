from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.routers import auth, todos, events

settings = get_settings()

app = FastAPI(title="Chronos Calendar API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
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

@app.get("/")
async def root():
    return {"message": "Chronos Calendar API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
