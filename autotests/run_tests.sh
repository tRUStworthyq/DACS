
#!/bin/bash

# Запуск автотестов и сохранение результатов для Allure
pytest --alluredir=allure-results --clean-alluredir

# Сохраняем код завершения pytest
TEST_EXIT_CODE=$?

# Формирование и открытие отчета
allure serve allure-results

# Возвращаем результат выполнения тестов
exit $TEST_EXIT_CODE
