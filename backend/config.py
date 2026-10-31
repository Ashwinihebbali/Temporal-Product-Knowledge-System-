from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

class Settings(BaseSettings):
    data_dir: Path = Path("../axis2_cleaned/axis2_cleaned")
    model_path: Path = Path("../axis2_model/axis2_model/model_output/link_model.joblib")
    feature_db_path: Path = Path("chronodev_features.sqlite3")
    # Leave DATABASE_URL empty to keep using the current local SQLite store.
    database_url: str = ""
    neo4j_uri: str = ""
    neo4j_user: str = "neo4j"
    neo4j_password: str = ""
    neo4j_database: str = "neo4j"
    graph_sync_interval_seconds: int = 10
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"
    use_ollama: bool = True
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
