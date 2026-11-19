for (const toggle of document.querySelectorAll('[data-dacs-password]')) {
    const password = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!(password instanceof HTMLInputElement)) continue;

    toggle.hidden = false;
    toggle.addEventListener('click', () => {
        const visible = password.type === 'password';
        password.type = visible ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(visible));
        toggle.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
    });
}

window.dacsSubmitRecaptcha = () => document.getElementById('kc-register-form')?.requestSubmit();

const email = document.querySelector('#kc-register-form #email');
if (email instanceof HTMLInputElement && !email.placeholder) {
    email.placeholder = 'name@company.com';
}

const profileLabels = {
    email: ['Email', 'Электронная почта'],
    username: ['Username', 'Имя пользователя'],
    firstName: ['First name', 'Имя'],
    lastName: ['Last name', 'Фамилия'],
};
for (const [id, [defaultLabel, translation]] of Object.entries(profileLabels)) {
    const label = document.querySelector('#kc-register-form label[for="' + id + '"]');
    const text = Array.from(label?.childNodes || []).find(node =>
        node.nodeType === Node.TEXT_NODE && node.textContent.trim() === defaultLabel);
    if (text) text.textContent = translation;
}