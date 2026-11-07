import allure


@allure.title("получение всех чатов пользователя")
@allure.severity(allure.severity_level.CRITICAL)
def test_get_capi_chats(api_session, api_base_url):
    with allure.step("формирование url"):
        url = f"{api_base_url}/api/chats"
        response = api_session.get(url)

    with allure.step("проверка успешного статус кода"):
        assert response.status_code == 200

    allure.attach(
        response.text,
        name="ответ API",
        attachment_type=allure.attachment_type.JSON
    )

    with allure.step("получение json"):
        data = response.json()

    with allure.step("проверка структуры ответа"):
        assert isinstance(data, dict)
        assert isinstance(data["items"], list)
        assert isinstance(data["nextCursor"], (str, type(None)))
        assert isinstance(data["hasMore"], bool)

        for chat in data["items"]:
            assert isinstance(chat, dict)

            assert isinstance(chat["id"], str)
            assert isinstance(chat["title"], str)
            assert isinstance(chat["createdAt"], str)
            assert isinstance(chat["updatedAt"], str)
