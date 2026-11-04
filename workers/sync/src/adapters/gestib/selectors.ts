/**
 * GestIB selectors and URLs — the ONLY place real portal internals may live (CLAUDE.md golden rule 1).
 *
 * Every value is 'TO_BE_DISCOVERED' until a human captures anonymised fixtures from a real session
 * (docs/SELECTOR_DISCOVERY.md). When you fill one in, add a comment naming the fixture file it came
 * from, e.g.  usernameInput: '#j_username', // fixtures/gestib/login/username-page.html
 *
 * Values marked KNOWN below come from SPEC §2 (observed on the founder's account).
 */

export const TBD = 'TO_BE_DISCOVERED' as const;

export interface GestibSelectors {
  urls: {
    /** Famílies entry point that redirects to the idp. */
    entry: string;
    /** Base for section slugs, ending with '/'. */
    familiesBase: string;
  };
  login: {
    usernameInput: string;
    usernameSubmit: string;
    passwordInput: string;
    passwordSubmit: string;
    /** Element present only when authenticated in Famílies. */
    loggedInMarker: string;
    invalidCredentialsMarker: string;
    /** Lower-case substrings that, if found in the page text, mean invalid credentials. */
    invalidCredentialsTexts: string[];
    forcedPasswordChangeMarker: string;
    passwordExpiredMarker: string;
    accountLockedMarker: string;
    captchaMarker: string;
  };
  children: {
    /** One element per child in the "Otros alumnos" switcher. */
    option: string;
    refAttr: string;
    currentAttr: string;
    schoolAttr: string;
    classAttr: string;
    /** 'click' = clicking the option switches child. Mechanism is TBD (SPEC §2). */
    switchMechanism: 'click' | typeof TBD;
  };
  section: {
    item: string;
    itemRefAttr: string;
    title: string;
    body: string;
    sender: string;
    date: string;
    dateAttr: string;
    deadline: string;
    attachment: string;
  };
  reply: {
    formUrl: (itemRef: string) => string;
    text: string;
    submit: string;
    successMarker: string;
    successRefAttr: string;
  };
}

export const gestibSelectors: GestibSelectors = {
  urls: {
    entry: TBD,
    familiesBase: 'https://www3.caib.es/xestibback/families/', // KNOWN: SPEC §2
  },
  login: {
    usernameInput: TBD,
    usernameSubmit: TBD,
    passwordInput: TBD,
    passwordSubmit: TBD,
    loggedInMarker: TBD,
    invalidCredentialsMarker: TBD,
    invalidCredentialsTexts: ['invalid username or password'], // KNOWN (en variant): SPEC §2; ca/es TBD
    forcedPasswordChangeMarker: TBD,
    passwordExpiredMarker: TBD,
    accountLockedMarker: TBD,
    captchaMarker: TBD,
  },
  children: {
    option: TBD,
    refAttr: TBD,
    currentAttr: TBD,
    schoolAttr: TBD,
    classAttr: TBD,
    switchMechanism: TBD,
  },
  section: {
    item: TBD,
    itemRefAttr: TBD,
    title: TBD,
    body: TBD,
    sender: TBD,
    date: TBD,
    dateAttr: TBD,
    deadline: TBD,
    attachment: TBD,
  },
  reply: {
    formUrl: () => TBD,
    text: TBD,
    submit: TBD,
    successMarker: TBD,
    successRefAttr: TBD,
  },
};
