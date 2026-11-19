# Включение регистрации DACS в Keycloak

В проекте используется realm `DACS`. Для новых импортов параметр `registrationAllowed` уже установлен в `true` в `infra/keycloak/import/realm-dev.json`.

Если Keycloak уже запускался, его realm хранится в отдельной PostgreSQL базе и простое изменение импортируемого JSON не обновит существующие настройки. Примените изменение к работающему realm:

```bash
chmod +x infra/keycloak/enable-registration.sh
./infra/keycloak/enable-registration.sh
```

Скрипт использует административные переменные `KEYCLOAK_ADMIN` и `KEYCLOAK_ADMIN_PASSWORD` уже работающего контейнера `keycloak` и включает `registrationAllowed=true` для realm `DACS`. Он не удаляет realm, пользователей или базу данных.

Локальный dev compose задаёт `admin` / `admin` для административной учётной записи. Не используйте эти значения в production.

После успешного выполнения:

1. Откройте `http://localhost:8765/register`.
2. Нажмите «Открыть страницу регистрации».
3. На странице входа Keycloak выберите ссылку `Register` / «Регистрация».
4. Заполните данные. При необходимости после регистрации отдельно войдите через `/login`.

Frontend открывает Gateway `/oauth2/authorization/keycloak` в текущей вкладке. После входа Gateway возвращает пользователя на главную по адресу `http://localhost:8765/`.
