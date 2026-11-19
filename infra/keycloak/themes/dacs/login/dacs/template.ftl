<#ftl output_format="HTML">
<#macro glyph name>
    <span class="dacs-icon icon-${name}" aria-hidden="true"></span>
</#macro>

<#macro artwork mode>
    <section class="auth-artwork">
        <div class="art-topline">
            <span class="art-index">DACS / DATA INTELLIGENCE</span>
            <span class="art-coordinate">DATA LIFECYCLE MANAGEMENT</span>
        </div>
        <div class="art-content">
            <div class="art-tag"><span></span> КОНТРОЛЬ ЖИЗНЕННОГО ЦИКЛА ДАННЫХ</div>
            <h1><#if mode == "login">Данные под<br><em>контролем.</em><#else>Начните<br>с <em>порядка.</em></#if></h1>
            <p>Единое пространство для управления корпоративными источниками и жизненным циклом данных.</p>
            <div class="art-visual" aria-hidden="true">
                <div class="orbit orbit-one"></div>
                <div class="orbit orbit-two"></div>
                <div class="orbit orbit-three"></div>
                <div class="orbit-core"><img src="${url.resourcesPath}/img/database.svg" alt=""></div>
                <span class="orbit-node node-a"><img src="${url.resourcesPath}/img/hard-drive.svg" alt=""></span>
                <span class="orbit-node node-b"><img src="${url.resourcesPath}/img/git-branch.svg" alt=""></span>
                <span class="orbit-node node-c"><img src="${url.resourcesPath}/img/shield-check.svg" alt=""></span>
                <span class="orbit-node node-d"><img src="${url.resourcesPath}/img/archive.svg" alt=""></span>
            </div>
        </div>
        <div class="art-bottom"><span>INTELLIGENCE FOR DATA GOVERNANCE</span><span>01 — 03</span></div>
    </section>
</#macro>

<#macro page mode title description showMessage=true>
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} · DACS</title>
    <link rel="stylesheet" href="${url.resourcesPath}/css/dacs.css">
    <script src="${url.resourcesPath}/js/dacs.js" defer></script>
    <script type="importmap">{"imports":{"rfc4648":"${url.resourcesCommonPath?js_string?no_esc}/vendor/rfc4648/rfc4648.js"}}</script>
    <#list (scripts![]) as script>
        <script src="${script}"></script>
    </#list>
</head>
<body>
<main class="auth-page">
    <@artwork mode=mode />
    <section class="auth-side" aria-labelledby="dacs-title">
        <header class="auth-header">
            <a class="brand" href="${properties.homeUrl!'/'}" aria-label="DACS — главная">
                <span class="brand-mark" aria-hidden="true"><span></span></span>
                <span class="brand-word">DACS<span class="brand-dot">.</span></span>
            </a>
            <a class="auth-back" href="${properties.homeUrl!'/'}"><@glyph name="arrow-up-right" />На главную</a>
        </header>
        <div class="auth-card-wrap">
            <div class="auth-eyebrow"><span></span> SECURE ACCESS / DACS</div>
            <h2 id="dacs-title">${title}<span>.</span></h2>
            <p class="auth-subtitle">${description}</p>
            <#if showMessage && message?has_content && (message.type != "warning" || !isAppInitiatedAction??)>
                <div class="auth-feedback auth-feedback-${message.type}" role="alert">${kcSanitize(message.summary)?no_esc}</div>
            </#if>
            <#nested>
            <div class="auth-security"><@glyph name="lock-keyhole" />Авторизация выполняется на Gateway через Keycloak</div>
        </div>
        <footer class="auth-footer"><span>© DACS</span><span>Корпоративная система управления данными</span></footer>
    </section>
</main>
<script type="module" src="${url.resourcesPath}/js/dacs-session.js"
        data-sso-url="${url.ssoLoginInOtherTabsUrl}"
        <#if authenticationSession??>data-session-hash="${authenticationSession.authSessionIdHash}"</#if>></script>
</body>
</html>
</#macro>

<#macro password field label hint autocomplete invalid=false>
    <#assign error = messagesPerField.existsError(field)>
    <div class="auth-field-line">
        <label for="${field}">${label}</label>
        <#nested>
    </div>
    <div class="auth-input">
        <@glyph name="lock-keyhole" />
        <input id="${field}" name="${field}" type="password" placeholder="${hint}" autocomplete="${autocomplete}"
               required aria-invalid="${(error || invalid)?c}"
               <#if invalid>aria-describedby="input-error"<#elseif error>aria-describedby="error-${field}"</#if>>
        <button class="password-toggle" type="button" data-dacs-password aria-controls="${field}"
                aria-label="Показать пароль" aria-pressed="false" hidden>
            <@glyph name="eye" /><@glyph name="eye-off" />
        </button>
    </div>
    <#if error && !invalid><@fieldError field=field /></#if>
</#macro>

<#macro fieldError field>
    <#if messagesPerField.existsError(field)>
        <span id="error-${field}" class="auth-field-error" aria-live="polite">${kcSanitize(messagesPerField.get(field))?no_esc}</span>
    </#if>
</#macro>
