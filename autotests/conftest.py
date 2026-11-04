import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

#корневая папка DACS
PROJECT_ROOT = Path(__file__).resolve().parent.parent

#загрузка локальных настроек
load_dotenv(PROJECT_ROOT / ".env")

BASE_URL = os.getenv("BASE_URL", "http://localhost:8082")
KEYCLOAK_BASE_URL = os.getenv(
    "KEYCLOAK_BASE_URL",
    "https://keycloak:8443"
)

KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "DACS")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "gateway")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")
KEYCLOAK_USERNAME = os.getenv("KEYCLOAK_USERNAME")
KEYCLOAK_PASSWORD = os.getenv("KEYCLOAK_PASSWORD")

KEYCLOAK_CA_CERT = os.getenv("KEYCLOAK_CA_CERT") or True

@pytest.fixture(scope="function")
def api_session():
    #запросы к keycloak
    keycloak_session = requests.Session()
    keycloak_session.verify = KEYCLOAK_CA_CERT
    #запросы к core
    core_session = requests.Session()

    try:
        token_response = keycloak_session.post(
            f"{KEYCLOAK_BASE_URL}/realms/{KEYCLOAK_REALM}"
            "/protocol/openid-connect/token",
            data = {
                "grant_type":"password",
                "client_id":KEYCLOAK_CLIENT_ID,
                "client_secret":KEYCLOAK_CLIENT_SECRET,
                "username":KEYCLOAK_USERNAME,
                "password":KEYCLOAK_PASSWORD,
                "scope": "openid profile email"
            },
            timeout = 10
        )

        assert token_response.status_code == 200, (
            f"Failed to obtain token: {token_response.status_code}, "
            f"{token_response.text}"
        )

        token_data = token_response.json()
        access_token = token_data["access_token"]

        user_info_response = keycloak_session.get(
            f"{KEYCLOAK_BASE_URL}/realms/{KEYCLOAK_REALM}"
            "/protocol/openid-connect/userinfo",
            headers = {
                "Authorization" : f"Bearer {access_token}"
            },
            timeout = 10
        )

        assert user_info_response.status_code == 200, (
            f"Failed to get user info: {user_info_response.status_code}, "
            f"{user_info_response.text}"
        )

        user_info_data = user_info_response.json()
        user_id = user_info_data["sub"]

        core_session.headers.update({
                "Authorization": f"Bearer {access_token}",
                "X-User-Id": user_id
        })

        yield core_session

    finally:
        core_session.close()
        keycloak_session.close()
