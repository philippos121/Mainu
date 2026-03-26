from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    RIS_API_BASE_URL: str = "https://data.bka.gv.at/ris/api/v2.6"

    # Optional SMTP settings for email report delivery
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "noreply@ristracker.app"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
