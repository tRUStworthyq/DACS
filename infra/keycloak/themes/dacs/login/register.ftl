<#ftl output_format="HTML">
<#import "dacs/template.ftl" as dacs>
<#import "user-profile-commons.ftl" as profileFields>
<#import "register-commons.ftl" as registerCommons>
<@dacs.page mode="register" title="Создать аккаунт"
            description="Регистрация пользователей будет выполняться через корпоративный Identity Provider."
            showMessage=messagesPerField.exists("global")>
    <form id="kc-register-form" class="auth-form auth-register" action="${url.registrationAction}" method="post">
        <@profileFields.userProfileFormFields; callback, attribute>
            <#if callback == "afterField" && passwordRequired?? &&
                 (attribute.name == "username" || (attribute.name == "email" && realm.registrationEmailAsUsername))>
                <@dacs.password field="password" label="Пароль" hint="Не менее 8 символов" autocomplete="new-password" />
                <@dacs.password field="password-confirm" label="Повторите пароль" hint="Повторите пароль" autocomplete="new-password" />
            </#if>
        </@profileFields.userProfileFormFields>

        <@registerCommons.termsAcceptance />

        <#if recaptchaRequired?? && (recaptchaVisible!false)>
            <div class="g-recaptcha" data-size="compact" data-sitekey="${recaptchaSiteKey}" data-action="${recaptchaAction}"></div>
        </#if>
        <button class="auth-submit<#if recaptchaRequired?? && !(recaptchaVisible!false)> g-recaptcha</#if>" type="submit"
                <#if recaptchaRequired?? && !(recaptchaVisible!false)>
                    data-sitekey="${recaptchaSiteKey}" data-action="${recaptchaAction}" data-callback="dacsSubmitRecaptcha"
                </#if>>
            Зарегистрироваться <@dacs.glyph name="arrow-right" />
        </button>
    </form>

    <div class="auth-switch">Уже зарегистрированы? <a href="${url.loginUrl}">Войти</a></div>
</@dacs.page>
