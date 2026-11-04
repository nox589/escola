/**
 * SYNTHETIC placeholder pages. These are NOT copies of GestIB markup and must not be mistaken for it.
 * Every element the adapter reads carries a `data-mock` attribute so tests run against
 * `selectors.mock.ts`. When real fixtures are captured (T1.4), they are served from
 * fixtures/gestib/<section>/ instead, and the real `selectors.ts` is written against those.
 */

export interface MockItem {
  ref: string;
  title: string;
  body: string;
  sender?: string;
  postedAt?: string;
  deadline?: string;
  attachments?: { name: string; content: string }[];
}

export interface MockChild {
  ref: string;
  name: string;
  school: string;
  classLabel: string;
  sections: Partial<Record<string, MockItem[]>>;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const page = (title: string, body: string) =>
  `<!doctype html><html lang="ca"><head><meta charset="utf-8"><title>${esc(title)} (MOCK)</title></head>
<body data-mock-page="${esc(title)}"><p class="mock-banner">Mock portal for tests. Not GestIB.</p>${body}</body></html>`;

export const usernamePage = () =>
  page(
    'login-username',
    `<form method="post" action="/idp/username" data-mock="username-form">
       <input name="username" data-mock="username-input"><button data-mock="username-submit">Continue</button>
     </form>`,
  );

export const passwordPage = (error?: string) =>
  page(
    'login-password',
    `${error ? `<div data-mock="login-error">${esc(error)}</div>` : ''}
     <form method="post" action="/idp/passwordLoginForm" data-mock="password-form">
       <input type="password" name="password" data-mock="password-input"><button data-mock="password-submit">Entrar</button>
     </form>`,
  );

export const forcedChangePage = () =>
  page('forced-password-change', `<div data-mock="forced-password-change">Cal canviar la contrasenya</div>`);
export const expiredPasswordPage = () =>
  page('password-expired', `<div data-mock="password-expired">La contrasenya ha caducat</div>`);
export const lockedPage = () =>
  page('account-locked', `<div data-mock="account-locked">Compte bloquejat</div>`);
export const captchaPage = () => page('captcha', `<div data-mock="captcha">Captcha</div>`);
export const downPage = () => page('down', `<h1>Servei no disponible</h1>`);

export function childSwitcher(children: MockChild[], current: string) {
  return `<nav data-mock="child-switcher">${children
    .map(
      (c) => `<form method="post" action="/families/otherStudents">
        <input type="hidden" name="childRef" value="${esc(c.ref)}">
        <button data-mock="child-option" data-mock-ref="${esc(c.ref)}" data-mock-school="${esc(c.school)}"
          data-mock-class="${esc(c.classLabel)}" ${c.ref === current ? 'data-mock-current="1"' : ''}>${esc(c.name)}</button>
      </form>`,
    )
    .join('')}</nav>`;
}

export function homePage(children: MockChild[], current: string) {
  return page('home', `<div data-mock="logged-in">Benvinguts</div>${childSwitcher(children, current)}`);
}

export function sectionPage(slug: string, children: MockChild[], current: string, items: MockItem[]) {
  const list = items
    .map(
      (it) => `<article data-mock="item" data-mock-ref="${esc(it.ref)}">
        <h2 data-mock="item-title">${esc(it.title)}</h2>
        ${it.sender ? `<span data-mock="item-sender">${esc(it.sender)}</span>` : ''}
        ${it.postedAt ? `<time data-mock="item-date" datetime="${esc(it.postedAt)}">${esc(it.postedAt)}</time>` : ''}
        ${it.deadline ? `<span data-mock="item-deadline">${esc(it.deadline)}</span>` : ''}
        <div data-mock="item-body">${esc(it.body)}</div>
        ${(it.attachments ?? [])
          .map(
            (a, i) =>
              `<a data-mock="item-attachment" href="/families/attachment/${esc(it.ref)}/${i}">${esc(a.name)}</a>`,
          )
          .join('')}
      </article>`,
    )
    .join('');
  return page(
    slug,
    `<div data-mock="logged-in"></div>${childSwitcher(children, current)}<section data-mock="section" data-mock-slug="${esc(slug)}">${list || '<p data-mock="empty">Cap element</p>'}</section>`,
  );
}

export function replyFormPage(itemRef: string) {
  return page(
    'reply-form',
    `<div data-mock="logged-in"></div><form method="post" action="/families/missatges/${esc(itemRef)}/reply" data-mock="reply-form">
       <textarea name="text" data-mock="reply-text"></textarea><button data-mock="reply-submit">Enviar</button>
     </form>`,
  );
}

export const replySentPage = (id: string) =>
  page(
    'reply-sent',
    `<div data-mock="logged-in"></div><div data-mock="submit-ok" data-mock-ref="${esc(id)}">Missatge enviat</div>`,
  );
