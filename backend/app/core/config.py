from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    RIS_API_BASE_URL: str = "https://data.bka.gv.at/ris/api/v2.6"

    # Email delivery
    RESEND_API_KEY: str = ""
    MAILERSEND_API_KEY: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
