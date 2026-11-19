import { checkAuthSession, startSessionPolling } from './authChecker.js';

const script = document.querySelector('script[data-sso-url]');
if (script?.dataset.ssoUrl) startSessionPolling(script.dataset.ssoUrl);
if (script?.dataset.sessionHash) checkAuthSession(script.dataset.sessionHash);
