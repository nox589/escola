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

/**
 * LIVE GestIB values captured 2026-11-04 in a human-run session (Andrew logged in himself).
 * Structure only, no personal data. Source notes: docs/capture/01..07-*.json (named per value).
 * Used by ./live.ts. The generic `gestibSelectors` above stays TBD for the old page-scraping path.
 */
export const gestibLive = {
  urls: {
    home: 'https://www3.caib.es/xestibback/families/home', // 03-home.json
    families: 'https://www3.caib.es/xestibback/families/', // 03-home.json
    idpHost: 'idp.caib.es', // 01-idp-username.json
  },
  login: {
    usernameInput: '#j_username', // 01-idp-username.json
    usernameSubmit: 'form#form-pass #loginpassbutton', // 01-idp-username.json
    passwordInput: '#j_password', // 02-idp-password.json
    passwordSubmit: 'form[action="/passwordLoginAction"] #loginpassbutton', // 02-idp-password.json
    loggedInMarker: 'input#codiFillSeleccionat', // 03-home.json
    /** Visible CAPTCHA widgets. The hidden captchaToken field alone is not a CAPTCHA (02-idp-password.json). */
    captchaMarker: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, img[src*="captcha" i]',
  },
  children: {
    selectedCard: 'div.alumno-seleccionado-card', // 03-home.json
    selectedRef: 'input#codiFillSeleccionat', // 03-home.json
    selectedBirthdate: 'input#dataNaixFillSeleccionat', // 03-home.json (dd/mm/yyyy)
    chip: 'button.alumno-chip', // 03-home.json
    chipRefInput: 'input[name="idFill"]', // 03-home.json (in the chip's form)
  },
  messages: {
    page: 'missatges', // 04-messages.json
    summaryUrl: '/xestibback/families/missatges/resumMissatgesXUsuari.json', // 04-messages.json
    listUrl: '/xestibback/families/missatges/llistaMissatgesXCodi.json', // 04-messages.json
    listParam: 'codisMissatges', // 04-messages.json
  },
  circulars: {
    page: 'circulars', // 06-circulars.json
    item: 'div.box[id^="circular_"]', // 06-circulars.json
    idPrefix: 'circular_',
    title: 'h4.box-title span.text', // 06-circulars.json
    body: 'div.text-enriquit', // 06-circulars.json
    attachment: 'a[href*="veureDocumentAdjunt.do"]', // 06-circulars.json
    unreadClass: 'circularNoVista', // 06-circulars.json
  },
  authorisations: {
    page: 'autoritzacions', // 05-authorisations.json
    item: 'div.box[id^="autoritzacio_"]', // 05-authorisations.json
    idPrefix: 'autoritzacio_',
    title: 'h4.box-title a', // 05-authorisations.json
    status: 'div.panel-collapse > span > b', // 05-authorisations.json
    body: 'div.text-enriquit', // 05-authorisations.json
    attachment: 'a[href*="veureDocumentAdjunt.do"]', // 05-authorisations.json
  },
  calendar: {
    page: 'calendariEscolar', // 07-calendar.json
    iframe: 'iframe.calendari-iframe', // 07-calendar.json
    frameUrlPart: 'calendari/calendariCentre', // 07-calendar.json
    month: 'div.month-container', // 07-calendar.json
    monthTitle: 'th.month-title', // 07-calendar.json
    day: 'td.day', // 07-calendar.json (.old/.new = adjacent months, skip)
    types: { vacances: 'holiday', festiu: 'public_holiday', festiuLocal: 'local_holiday', noLectiu: 'non_teaching', lliureDisposicio: 'free_choice' }, // 07-calendar.json legend
  },
  /** Per-child pages: render for the child selected on home (12-per-child-feeds.json). */
  timetable: {
    page: 'horari', // 09-timetable.json
    matriculaCall: /mostraHorariAlumne\(\s*'([^']+)'/, // 12-per-child-feeds.json
    feedUrl: '/xestibback/families/llistes/alumnat/quadrantHorariAlumnes.json', // 09-timetable.json
  },
  attendance: {
    page: 'assistencia', // 08-attendance.json
    /** pintaBotons("<codiMatricula>","<any>","<codiMatriculaParam>","<codiCentre>","<codiAlumne>","<cursAcademic>","<codiArbre>","<anyArbre>","<etapa>") */
    paramsCall: /pintaBotons\(([^)]*)\)/, // 12-per-child-feeds.json
    feedUrl: '/xestibback/families/alumne/llistaFaltesMatriculaAlumne.xml', // 08-attendance.json
    fixedPeriode: '12 Desembre 2016', // 08-attendance.json (sent verbatim by GestIB)
    justifyWindowDays: 60, // assistencia.js diesMarge (12-per-child-feeds.json)
  },
  agenda: {
    page: 'activitats', // 11-replies-activities.json
    form: 'form[id^="formHorari_"]', // 11-replies-activities.json
    formBody: 'mostraSessionsEsplais=S', // 12-per-child-feeds.json (plus idioma)
    /** JSON script blocks on the agenda page worth showing to parents (12-per-child-feeds.json). */
    blocks: {
      'data-eventAvaluacio': 'evaluation',
      'data-eventReunioPares': 'meeting',
      'data-eventAgenda': 'agenda',
      'data-eventAlumne': 'student',
      'data-eventsCentre_agenda': 'school_agenda',
      'data-sortidesEscolars': 'trip',
    },
  },
} as const;
