/**
 * Parent guide: getting a GestIB account and resetting the password. Content from the official
 * CAIB family guidance (summarised by the founder, 2026-11-05). GestIB's own button labels stay in
 * Catalan in every language, because that is what parents will see on screen.
 */
export interface GuideSection {
  id: 'account' | 'username' | 'reset' | 'rules' | 'problems' | 'contact';
  title: string;
  intro?: string;
  steps?: string[];
  bullets?: string[];
}
export interface GuideText {
  title: string;
  intro: string;
  sections: GuideSection[];
  usernameLabel: string;
  usernamePlaceholder: string;
  usernameResult: string;
  usernamePrivate: string;
  openReset: string;
  haveIt: string;
  back: string;
}

const en: GuideText = {
  title: 'Get your GestIB password',
  intro: 'MiCole signs in to GestIB Famílies for you, so you need a GestIB username and password. Tap a topic.',
  sections: [
    {
      id: 'account',
      title: "I don't have an account yet",
      steps: [
        'Go to the school office (secretaria) with your DNI or NIE. Only the school can create your account.',
        'They print a form with your details. Check it, sign it and hand it back.',
        'You get an SMS with your username and a link to set your password.',
      ],
      bullets: ['Passport only? The official family guide says that is not enough for an account. Ask the school office.'],
    },
    { id: 'username', title: "What's my username?", intro: 'It is "e" plus your ID number, all lowercase. Type your DNI or NIE to see it.' },
    {
      id: 'reset',
      title: 'I forgot my password',
      steps: [
        'Open GestIB and tap "Reiniciar/Restablir la contrasenya" (Reset password).',
        "Fill in YOUR details, not your child's. They must match the school's records exactly.",
        'Tap "Envia la sol·licitud" (Send request).',
        'Open the blue link in the email. A temporary password arrives by SMS.',
        'Within 24 hours, sign in and change it with "Canvi de contrasenya" (Change password). If you miss the 24 hours, the account blocks and you start again.',
      ],
    },
    {
      id: 'rules',
      title: 'Password rules',
      bullets: [
        '6 to 30 characters, starting with a letter, with at least one number.',
        'No @ ñ ç ! $ % / * + and no accents.',
        'Can’t reuse any of your last 4 passwords.',
        'It lasts 1 year, then you reset it again. MiCole will tell you when GestIB asks for a new one.',
      ],
    },
    {
      id: 'problems',
      title: "Something isn't working",
      bullets: [
        '"Les dades no coincideixen" (The details don’t match): the school office needs to update your contact details.',
        'The reset said it worked but you still can’t sign in: a known GestIB fault. Ask the school office to push the change again, then wait about 10 minutes.',
        'Digital certificate or Cl@ve: these can open GestIB in a browser, but MiCole needs a username and password.',
      ],
    },
    {
      id: 'contact',
      title: 'Who to contact',
      bullets: [
        'Your school office first: new accounts, details that don’t match, stuck resets.',
        'If the school can’t fix it, they can escalate to the Govern’s support (suport@caib.es).',
      ],
    },
  ],
  usernameLabel: 'Your DNI or NIE',
  usernamePlaceholder: 'e.g. 1234567K or X1234567M',
  usernameResult: 'Your GestIB username is probably:',
  usernamePrivate: 'Worked out on this phone. Your ID isn’t sent anywhere.',
  openReset: 'Open GestIB password reset',
  haveIt: 'I have my username and password',
  back: 'Back',
};

const es: GuideText = {
  title: 'Consigue tu contraseña de GestIB',
  intro: 'MiCole entra en GestIB Famílies por ti, así que necesitas un usuario y una contraseña de GestIB. Toca un tema.',
  sections: [
    {
      id: 'account',
      title: 'Aún no tengo cuenta',
      steps: [
        'Ve a la secretaría del centro con tu DNI o NIE. Solo el centro puede crear la cuenta.',
        'Te imprimen una hoja con tus datos. Revísala, fírmala y entrégala.',
        'Recibirás un SMS con tu usuario y un enlace para poner la contraseña.',
      ],
      bullets: ['¿Solo pasaporte? La guía oficial para familias dice que no basta. Pregunta en secretaría.'],
    },
    { id: 'username', title: '¿Cuál es mi usuario?', intro: 'Es una «e» más tu número de documento, todo en minúsculas. Escribe tu DNI o NIE para verlo.' },
    {
      id: 'reset',
      title: 'He olvidado la contraseña',
      steps: [
        'Abre GestIB y toca «Reiniciar/Restablir la contrasenya».',
        'Rellena TUS datos, no los de tu hijo o hija. Deben coincidir exactamente con los del centro.',
        'Toca «Envia la sol·licitud».',
        'Abre el enlace azul del correo. La contraseña temporal llega por SMS.',
        'En menos de 24 horas, entra y cámbiala con «Canvi de contrasenya». Si pasan las 24 horas, la cuenta se bloquea y hay que empezar de nuevo.',
      ],
    },
    {
      id: 'rules',
      title: 'Normas de la contraseña',
      bullets: [
        'De 6 a 30 caracteres, empieza por letra y con al menos un número.',
        'Sin @ ñ ç ! $ % / * + ni acentos.',
        'No puede repetir ninguna de las 4 últimas.',
        'Dura 1 año; después se restablece otra vez. MiCole te avisará cuando GestIB pida una nueva.',
      ],
    },
    {
      id: 'problems',
      title: 'Algo no funciona',
      bullets: [
        '«Les dades no coincideixen» (los datos no coinciden): secretaría tiene que actualizar tus datos de contacto.',
        'El cambio dice que ha ido bien pero no puedes entrar: es un fallo conocido de GestIB. Pide a secretaría que lo vuelva a enviar y espera unos 10 minutos.',
        'Certificado digital o Cl@ve: sirven para entrar en GestIB desde el navegador, pero MiCole necesita usuario y contraseña.',
      ],
    },
    {
      id: 'contact',
      title: 'A quién contactar',
      bullets: [
        'Primero, la secretaría del centro: cuentas nuevas, datos que no coinciden, cambios atascados.',
        'Si el centro no puede, lo escala al soporte del Govern (suport@caib.es).',
      ],
    },
  ],
  usernameLabel: 'Tu DNI o NIE',
  usernamePlaceholder: 'p. ej. 1234567K o X1234567M',
  usernameResult: 'Tu usuario de GestIB probablemente es:',
  usernamePrivate: 'Se calcula en este móvil. Tu documento no se envía a ningún sitio.',
  openReset: 'Abrir el cambio de contraseña de GestIB',
  haveIt: 'Ya tengo usuario y contraseña',
  back: 'Atrás',
};

const ca: GuideText = {
  title: 'Aconsegueix la contrasenya de GestIB',
  intro: 'MiCole entra a GestIB Famílies per tu, així que necessites un usuari i una contrasenya de GestIB. Toca un tema.',
  sections: [
    {
      id: 'account',
      title: 'Encara no tinc compte',
      steps: [
        'Ves a la secretaria del centre amb el DNI o NIE. Només el centre pot crear el compte.',
        'T’imprimeixen un full amb les teves dades. Revisa’l, signa’l i torna’l.',
        'Rebràs un SMS amb l’usuari i un enllaç per posar la contrasenya.',
      ],
      bullets: ['Només passaport? La guia oficial per a famílies diu que no és suficient. Pregunta a secretaria.'],
    },
    { id: 'username', title: 'Quin és el meu usuari?', intro: 'És una «e» més el número del document, tot en minúscules. Escriu el DNI o NIE per veure’l.' },
    {
      id: 'reset',
      title: 'He oblidat la contrasenya',
      steps: [
        'Obre GestIB i toca «Reiniciar/Restablir la contrasenya».',
        'Omple LES TEVES dades, no les del fill o filla. Han de coincidir exactament amb les del centre.',
        'Toca «Envia la sol·licitud».',
        'Obre l’enllaç blau del correu. La contrasenya temporal arriba per SMS.',
        'En menys de 24 hores, entra i canvia-la amb «Canvi de contrasenya». Si passen les 24 hores, el compte es bloqueja i s’ha de tornar a començar.',
      ],
    },
    {
      id: 'rules',
      title: 'Normes de la contrasenya',
      bullets: [
        'De 6 a 30 caràcters, comença per lletra i amb almenys un número.',
        'Sense @ ñ ç ! $ % / * + ni accents.',
        'No pot repetir cap de les 4 darreres.',
        'Dura 1 any; després es restableix de nou. MiCole t’avisarà quan GestIB en demani una de nova.',
      ],
    },
    {
      id: 'problems',
      title: 'Alguna cosa no funciona',
      bullets: [
        '«Les dades no coincideixen»: secretaria ha d’actualitzar les teves dades de contacte.',
        'El canvi diu que ha anat bé però no pots entrar: és una errada coneguda de GestIB. Demana a secretaria que el torni a enviar i espera uns 10 minuts.',
        'Certificat digital o Cl@ve: serveixen per entrar a GestIB des del navegador, però MiCole necessita usuari i contrasenya.',
      ],
    },
    {
      id: 'contact',
      title: 'A qui contactar',
      bullets: [
        'Primer, la secretaria del centre: comptes nous, dades que no coincideixen, canvis encallats.',
        'Si el centre no ho pot resoldre, ho escala al suport del Govern (suport@caib.es).',
      ],
    },
  ],
  usernameLabel: 'El teu DNI o NIE',
  usernamePlaceholder: 'p. ex. 1234567K o X1234567M',
  usernameResult: 'El teu usuari de GestIB probablement és:',
  usernamePrivate: 'Es calcula en aquest mòbil. El document no s’envia enlloc.',
  openReset: 'Obrir el canvi de contrasenya de GestIB',
  haveIt: 'Ja tinc usuari i contrasenya',
  back: 'Enrere',
};

const de: GuideText = {
  title: 'Dein GestIB-Passwort bekommen',
  intro: 'MiCole meldet sich für dich bei GestIB Famílies an. Dafür brauchst du einen GestIB-Benutzernamen und ein Passwort. Tippe auf ein Thema.',
  sections: [
    {
      id: 'account',
      title: 'Ich habe noch kein Konto',
      steps: [
        'Geh mit deinem DNI oder NIE ins Schulsekretariat (secretaria). Nur die Schule kann das Konto anlegen.',
        'Sie drucken ein Blatt mit deinen Daten. Prüfen, unterschreiben, zurückgeben.',
        'Du bekommst eine SMS mit Benutzername und einem Link zum Passwort.',
      ],
      bullets: ['Nur Reisepass? Laut offiziellem Familienleitfaden reicht das nicht. Frag im Sekretariat.'],
    },
    { id: 'username', title: 'Wie lautet mein Benutzername?', intro: '„e“ plus deine Ausweisnummer, alles klein geschrieben. Gib deinen DNI oder NIE ein.' },
    {
      id: 'reset',
      title: 'Passwort vergessen',
      steps: [
        'Öffne GestIB und tippe auf „Reiniciar/Restablir la contrasenya“ (Passwort zurücksetzen).',
        'Gib DEINE Daten ein, nicht die deines Kindes. Sie müssen genau mit denen der Schule übereinstimmen.',
        'Tippe auf „Envia la sol·licitud“ (Anfrage senden).',
        'Öffne den blauen Link in der E-Mail. Ein vorläufiges Passwort kommt per SMS.',
        'Innerhalb von 24 Stunden anmelden und mit „Canvi de contrasenya“ ändern. Sonst wird das Konto gesperrt und du fängst von vorn an.',
      ],
    },
    {
      id: 'rules',
      title: 'Passwortregeln',
      bullets: [
        '6 bis 30 Zeichen, beginnt mit einem Buchstaben, mindestens eine Zahl.',
        'Kein @ ñ ç ! $ % / * + und keine Akzente.',
        'Keines der letzten 4 Passwörter wiederverwenden.',
        'Gilt 1 Jahr, dann erneut zurücksetzen. MiCole sagt dir Bescheid, wenn GestIB ein neues verlangt.',
      ],
    },
    {
      id: 'problems',
      title: 'Etwas funktioniert nicht',
      bullets: [
        '„Les dades no coincideixen“ (Daten stimmen nicht überein): Das Sekretariat muss deine Kontaktdaten aktualisieren.',
        'Zurücksetzen hat angeblich geklappt, Anmeldung geht trotzdem nicht: ein bekannter GestIB-Fehler. Das Sekretariat muss die Änderung erneut senden, dann etwa 10 Minuten warten.',
        'Digitales Zertifikat oder Cl@ve: öffnet GestIB im Browser, aber MiCole braucht Benutzername und Passwort.',
      ],
    },
    {
      id: 'contact',
      title: 'Wen fragen',
      bullets: [
        'Zuerst das Schulsekretariat: neue Konten, falsche Daten, hängende Zurücksetzungen.',
        'Kann die Schule es nicht lösen, wendet sie sich an den Support der Regierung (suport@caib.es).',
      ],
    },
  ],
  usernameLabel: 'Dein DNI oder NIE',
  usernamePlaceholder: 'z. B. 1234567K oder X1234567M',
  usernameResult: 'Dein GestIB-Benutzername ist wahrscheinlich:',
  usernamePrivate: 'Wird auf diesem Handy berechnet. Deine Nummer wird nirgends hingeschickt.',
  openReset: 'GestIB-Passwort zurücksetzen öffnen',
  haveIt: 'Ich habe Benutzername und Passwort',
  back: 'Zurück',
};

const fr: GuideText = {
  title: 'Obtenir votre mot de passe GestIB',
  intro: 'MiCole se connecte à GestIB Famílies pour vous : il vous faut un identifiant et un mot de passe GestIB. Touchez un sujet.',
  sections: [
    {
      id: 'account',
      title: "Je n'ai pas encore de compte",
      steps: [
        'Allez au secrétariat de l’école (secretaria) avec votre DNI ou NIE. Seule l’école peut créer le compte.',
        'On vous imprime une fiche avec vos données. Vérifiez-la, signez-la et rendez-la.',
        'Vous recevez un SMS avec votre identifiant et un lien pour choisir le mot de passe.',
      ],
      bullets: ['Seulement un passeport ? Le guide officiel des familles dit que cela ne suffit pas. Demandez au secrétariat.'],
    },
    { id: 'username', title: 'Quel est mon identifiant ?', intro: 'C’est « e » suivi de votre numéro de document, tout en minuscules. Tapez votre DNI ou NIE.' },
    {
      id: 'reset',
      title: "J'ai oublié mon mot de passe",
      steps: [
        'Ouvrez GestIB et touchez « Reiniciar/Restablir la contrasenya » (réinitialiser).',
        'Remplissez VOS données, pas celles de l’enfant. Elles doivent correspondre exactement à celles de l’école.',
        'Touchez « Envia la sol·licitud » (envoyer la demande).',
        'Ouvrez le lien bleu de l’e-mail. Un mot de passe temporaire arrive par SMS.',
        'Dans les 24 heures, connectez-vous et changez-le avec « Canvi de contrasenya ». Sinon le compte se bloque et il faut recommencer.',
      ],
    },
    {
      id: 'rules',
      title: 'Règles du mot de passe',
      bullets: [
        '6 à 30 caractères, commence par une lettre, au moins un chiffre.',
        'Pas de @ ñ ç ! $ % / * + ni d’accents.',
        'Pas l’un des 4 derniers mots de passe.',
        'Valable 1 an, puis il faut le réinitialiser. MiCole vous préviendra quand GestIB en demande un nouveau.',
      ],
    },
    {
      id: 'problems',
      title: 'Quelque chose ne marche pas',
      bullets: [
        '« Les dades no coincideixen » (les données ne correspondent pas) : le secrétariat doit mettre à jour vos coordonnées.',
        'La réinitialisation a « réussi » mais la connexion échoue : un défaut connu de GestIB. Demandez au secrétariat de renvoyer la modification, puis attendez environ 10 minutes.',
        'Certificat numérique ou Cl@ve : ils ouvrent GestIB dans un navigateur, mais MiCole a besoin d’un identifiant et d’un mot de passe.',
      ],
    },
    {
      id: 'contact',
      title: 'Qui contacter',
      bullets: [
        'D’abord le secrétariat de l’école : nouveaux comptes, données qui ne correspondent pas, réinitialisations bloquées.',
        'Si l’école ne peut pas régler le problème, elle contacte le support du Govern (suport@caib.es).',
      ],
    },
  ],
  usernameLabel: 'Votre DNI ou NIE',
  usernamePlaceholder: 'ex. 1234567K ou X1234567M',
  usernameResult: 'Votre identifiant GestIB est probablement :',
  usernamePrivate: 'Calculé sur ce téléphone. Votre numéro n’est envoyé nulle part.',
  openReset: 'Ouvrir la réinitialisation GestIB',
  haveIt: "J'ai mon identifiant et mon mot de passe",
  back: 'Retour',
};

const it: GuideText = {
  title: 'Ottieni la password di GestIB',
  intro: 'MiCole accede a GestIB Famílies per te, quindi ti servono nome utente e password di GestIB. Tocca un argomento.',
  sections: [
    {
      id: 'account',
      title: 'Non ho ancora un account',
      steps: [
        'Vai in segreteria (secretaria) con il tuo DNI o NIE. Solo la scuola può creare l\u2019account.',
        'Ti stampano un modulo con i tuoi dati. Controllalo, firmalo e riconsegnalo.',
        'Ricevi un SMS con il nome utente e un link per impostare la password.',
      ],
      bullets: ['Solo passaporto? La guida ufficiale per le famiglie dice che non basta. Chiedi in segreteria.'],
    },
    { id: 'username', title: 'Qual è il mio nome utente?', intro: 'È una «e» seguita dal numero del documento, tutto minuscolo. Scrivi il tuo DNI o NIE per vederlo.' },
    {
      id: 'reset',
      title: 'Ho dimenticato la password',
      steps: [
        'Apri GestIB e tocca «Reiniciar/Restablir la contrasenya» (reimposta password).',
        'Inserisci I TUOI dati, non quelli di tuo figlio. Devono coincidere esattamente con quelli della scuola.',
        'Tocca «Envia la sol·licitud» (invia la richiesta).',
        'Apri il link blu nell\u2019email. Una password temporanea arriva via SMS.',
        'Entro 24 ore accedi e cambiala con «Canvi de contrasenya». Se superi le 24 ore, l\u2019account si blocca e devi ricominciare.',
      ],
    },
    {
      id: 'rules',
      title: 'Regole della password',
      bullets: [
        'Da 6 a 30 caratteri, inizia con una lettera e contiene almeno un numero.',
        'Niente @ ñ ç ! $ % / * + né accenti.',
        'Non puoi riusare nessuna delle ultime 4.',
        'Dura 1 anno, poi va reimpostata. MiCole ti avvisa quando GestIB ne chiede una nuova.',
      ],
    },
    {
      id: 'problems',
      title: 'Qualcosa non funziona',
      bullets: [
        '«Les dades no coincideixen» (i dati non coincidono): la segreteria deve aggiornare i tuoi recapiti.',
        'Il ripristino dice che è andato bene ma non riesci ad accedere: è un difetto noto di GestIB. Chiedi alla segreteria di reinviare la modifica e attendi circa 10 minuti.',
        'Certificato digitale o Cl@ve: aprono GestIB nel browser, ma MiCole ha bisogno di nome utente e password.',
      ],
    },
    {
      id: 'contact',
      title: 'Chi contattare',
      bullets: [
        'Prima la segreteria della scuola: nuovi account, dati che non coincidono, ripristini bloccati.',
        'Se la scuola non riesce, inoltra al supporto del Govern (suport@caib.es).',
      ],
    },
  ],
  usernameLabel: 'Il tuo DNI o NIE',
  usernamePlaceholder: 'es. 1234567K o X1234567M',
  usernameResult: 'Il tuo nome utente GestIB probabilmente è:',
  usernamePrivate: 'Calcolato su questo telefono. Il documento non viene inviato da nessuna parte.',
  openReset: 'Apri il ripristino password di GestIB',
  haveIt: 'Ho nome utente e password',
  back: 'Indietro',
};

export const GUIDE: Record<string, GuideText> = { en, es, ca, de, fr, it };
export const guideFor = (lang: string) => GUIDE[lang] ?? en;

/** GestIB username from a DNI/NIE: "e" + the ID, lowercase, without spaces or dashes. */
export function gestibUsername(id: string): string | null {
  const clean = id.replace(/[\s.-]/g, '').toLowerCase();
  return /^([xyz]?\d{7,8}[a-z])$/.test(clean) ? `e${clean}` : null;
}
