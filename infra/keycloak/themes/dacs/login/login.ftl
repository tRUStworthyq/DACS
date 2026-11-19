<#ftl output_format="HTML">
<#import "dacs/template.ftl" as dacs>
<#import "passkeys.ftl" as passkeys>
<#assign invalidCredentials = messagesPerField.existsError("username", "password")>
<@dacs.page mode="login" title="Вход в систему" description="Доступ к рабочему пространству DACS."
            showMessage=!invalidCredentials>
    <#if realm.password>
        <form id="kc-form-login" class="auth-form" action="${url.loginAction}" method="post">
            <#if !usernameHidden??>
                <label for="username"><#if realm.loginWithEmailAllowed>Электронная почта<#else>Имя пользователя</#if></label>
                <div class="auth-input">
                    <@dacs.glyph name="mail" />
                    <input id="username" name="username" type="text" value="${(login.username!'')}"
                           placeholder="<#if realm.loginWithEmailAllowed>name@company.com<#else>Имя пользователя</#if>"
                           autocomplete="${enableWebAuthnConditionalUI?has_content?then('username webauthn', 'username')}"
                           autofocus required aria-invalid="${invalidCredentials?c}"
                           <#if invalidCredentials>aria-describedby="input-error"</#if>>
                </div>
            </#if>
            <@dacs.password field="password" label="Пароль" hint="Введите пароль"
                             autocomplete="current-password" invalid=invalidCredentials>
                <#if realm.resetPasswordAllowed>
                    <a class="auth-text-button" href="${url.loginResetCredentialsUrl}">Забыли пароль?</a>
                </#if>
            </@dacs.password>
            <#if invalidCredentials>
                <span id="input-error" class="auth-field-error" role="alert">
                    ${kcSanitize(messagesPerField.getFirstError("username", "password"))?no_esc}
                </span>
            </#if>
            <#if realm.rememberMe && !usernameHidden??>
                <label class="auth-check">
                    <input id="rememberMe" name="rememberMe" type="checkbox" <#if login.rememberMe??>checked</#if>>
                    <span aria-hidden="true"><@dacs.glyph name="check" /></span>
                    Запомнить меня
                </label>
            </#if>
            <input type="hidden" name="credentialId" value="${(auth.selectedCredential)!''}">
            <button id="kc-login" class="auth-submit" type="submit" name="login">
                Войти <@dacs.glyph name="arrow-right" />
            </button>
        </form>
        <@passkeys.conditionalUIData />
    </#if>
    <#if auth?has_content && auth.showTryAnotherWayLink()>
        <form class="auth-other" action="${url.loginAction}" method="post">
            <button class="auth-text-button" type="submit" name="tryAnotherWay" value="on">${msg("doTryAnotherWay")}</button>
        </form>
    </#if>
    <#if social?? && social.providers?has_content>
        <div class="auth-switch">
            <p>${msg("identity-provider-login-label")}</p>
            <#list social.providers as provider>
                <a href="${provider.loginUrl}">${provider.displayName!provider.alias}</a>
            </#list>
        </div>
    </#if>
    <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
        <div class="auth-switch">Ещё нет аккаунта? <a href="${url.registrationUrl}">Зарегистрироваться</a></div>
    </#if>
</@dacs.page>
