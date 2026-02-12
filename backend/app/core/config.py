from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://lexwatch:lexwatch_secret@db:5432/lexwatch"
    SECRET_KEY: str = "change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    OPENAI_API_KEY: str = ""
    RIS_API_BASE_URL: str = "https://data.bka.gv.at/ris/api/v2.6"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
