import pytest
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8082"
KEYCLOAK_BASE_URL = "https://keycloak:8443"

@pytest.fixture(scope="function")
def api_request():
    with sync_playwright() as p:
        keycloak_context = p.request.new_context(
            base_url = KEYCLOAK_BASE_URL,
            ignore_https_errors=True
        )

        token_response = keycloak_context.post(
            "/realms/DACS/protocol/openid-connect/token",
            form = {
                "grant_type":"password",
                "client_id":"gateway",
                "client_secret":"dev-client-secret-local-only",
                "username":"testuser",
                "password":"testpass123",
                "scope": "openid profile email"
            }
        )
        assert token_response.status == 200
        token_data = token_response.json()

        access_token = token_data["access_token"]

        user_info_response = keycloak_context.get(
            "/realms/DACS/protocol/openid-connect/userinfo",
            headers = {
                "Authorization" : f"Bearer {access_token}"
            }
        )

        assert user_info_response.status == 200
        user_info_data = user_info_response.json()

        sub = user_info_data["sub"]

        request_context = p.request.new_context(
            base_url = BASE_URL,
            extra_http_headers = {
                "Authorization": f"Bearer {access_token}",
                "X-User-Id": sub
            }
        )

        yield request_context

        request_context.dispose()
        keycloak_context.dispose()
