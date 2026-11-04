import type { GestibSelectors } from './selectors.js';

/**
 * Selectors for apps/mock-portal's SYNTHETIC pages (data-mock attributes). Tests only.
 * These say nothing about real GestIB markup.
 */
export function mockSelectors(base: string): GestibSelectors {
  return {
    urls: { entry: `${base}/families/home`, familiesBase: `${base}/families/` },
    login: {
      usernameInput: '[data-mock="username-input"]',
      usernameSubmit: '[data-mock="username-submit"]',
      passwordInput: '[data-mock="password-input"]',
      passwordSubmit: '[data-mock="password-submit"]',
      loggedInMarker: '[data-mock="logged-in"]',
      invalidCredentialsMarker: '[data-mock="login-error"]',
      invalidCredentialsTexts: ['invalid username or password'],
      forcedPasswordChangeMarker: '[data-mock="forced-password-change"]',
      passwordExpiredMarker: '[data-mock="password-expired"]',
      accountLockedMarker: '[data-mock="account-locked"]',
      captchaMarker: '[data-mock="captcha"]',
    },
    children: {
      option: '[data-mock="child-option"]',
      refAttr: 'data-mock-ref',
      currentAttr: 'data-mock-current',
      schoolAttr: 'data-mock-school',
      classAttr: 'data-mock-class',
      switchMechanism: 'click',
    },
    section: {
      item: '[data-mock="item"]',
      itemRefAttr: 'data-mock-ref',
      title: '[data-mock="item-title"]',
      body: '[data-mock="item-body"]',
      sender: '[data-mock="item-sender"]',
      date: '[data-mock="item-date"]',
      dateAttr: 'datetime',
      deadline: '[data-mock="item-deadline"]',
      attachment: '[data-mock="item-attachment"]',
    },
    reply: {
      formUrl: (ref) => `${base}/families/missatges/${encodeURIComponent(ref)}/reply`,
      text: '[data-mock="reply-text"]',
      submit: '[data-mock="reply-submit"]',
      successMarker: '[data-mock="submit-ok"]',
      successRefAttr: 'data-mock-ref',
    },
  };
}
