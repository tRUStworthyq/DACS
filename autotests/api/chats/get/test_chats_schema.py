import uuid
import re
from datetime import datetime

import allure

DATE_TIME_PATTERN = (
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T"
    r"[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?"
    r"(?:Z|[+-][0-9]{2}:[0-9]{2})"
)

@allure.title("проверка валидации схемы")
@allure.description("данный тест кейс проверяет валидацию схемы, а именно: поля чатов, типы данных, даты и UUID")
@allure.severity(allure.severity_level.NORMAL)
def test_get_api_chats_response_schema(api_session, api_base_url):

    with allure.step("формирование url"):
        url = f"{api_base_url}/api/chats"
        response = api_session.get(url)

    with allure.step("проверка успешного статус кода"):
        assert response.status_code == 200

    with allure.step("проверка, что ответ приходит в формате application/json"):
        content_type = response.headers.get("Content-type", "")
        assert content_type.split(";")[0].strip().lower() == "application/json"

    with allure.step("формирование json ответа"):
        data = response.json()

        allure.attach(
            response.text,
            name="ответ API",
            attachment_type=allure.attachment_type.JSON
        )

    with allure.step("проверка структуры ответа"):
        assert isinstance(data, dict)

        assert isinstance(data["items"], list)
        assert isinstance(data["nextCursor"], (str, type(None)))
        assert isinstance(data["hasMore"], bool)

        chat_ids = []

        for chat in data["items"]:

            assert isinstance(chat, dict)

            with allure.step("проверка корректности формата uuid"):
                assert isinstance(chat["id"], str)
                parsed_id = uuid.UUID(chat["id"])
                chat_ids.append(str(parsed_id))

            with allure.step("проверка типа title"):
                assert isinstance(chat["title"], str)
                assert len(chat["title"]) <= 255

            with allure.step("проверка корректности даты создания по ISO 8601"):
                assert isinstance(chat["createdAt"], str)
                assert re.fullmatch(DATE_TIME_PATTERN, chat["createdAt"])
                datetime.fromisoformat(chat["createdAt"])

            with allure.step("проверка корректности даты обновления по ISO 8601"):
                assert isinstance(chat["updatedAt"], str)
                assert re.fullmatch(DATE_TIME_PATTERN, chat["updatedAt"])
                datetime.fromisoformat(chat["updatedAt"])

        with allure.step("проверка уникальности id"):
            assert len(chat_ids) == len(set(chat_ids))

#в след. реализации необходимо добавить:
#связи дат(создание не должно быть позже обновления)
#содержимое title - пока не ясно может ли он содержать null и пробелы
#строгое представление uuid
