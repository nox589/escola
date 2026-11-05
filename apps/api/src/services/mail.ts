import type { Mailer } from '../context.js';

/** Dev: prints to stdout (not the structured logger, which redacts). Never used in production. */
export class ConsoleMailer implements Mailer {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  constructor(private readonly print = true) {}
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text });
    if (this.print) process.stdout.write(`\n[mail] to=${to} subject=${subject}\n${text}\n\n`);
  }
}

/** Postmark (EU data residency available) via HTTP API. [OPEN] email vendor, see OPEN_QUESTIONS. */
export class PostmarkMailer implements Mailer {
  constructor(
    private readonly token: string,
    private readonly from: string,
  ) {}
  async send(to: string, subject: string, text: string) {
    const r = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-Postmark-Server-Token': this.token,
      },
      body: JSON.stringify({
        From: this.from,
        To: to,
        Subject: subject,
        TextBody: text,
        MessageStream: 'outbound',
      }),
    });
    if (!r.ok) throw new Error(`email send failed: ${r.status}`);
  }
}

const COPY: Record<string, { subject: string; body: (link: string) => string }> = {
  en: {
    subject: 'Your MiCole sign-in link',
    body: (l) => `Tap to sign in to MiCole:\n\n${l}\n\nThe link works once and expires in 15 minutes.`,
  },
  es: {
    subject: 'Tu enlace de acceso',
    body: (l) => `Pulsa para entrar en MiCole:\n\n${l}\n\nEl enlace funciona una vez y caduca en 15 minutos.`,
  },
  ca: {
    subject: "El teu enllaç d'accés",
    body: (l) => `Toca per entrar a MiCole:\n\n${l}\n\nL'enllaç funciona una vegada i caduca en 15 minuts.`,
  },
  de: {
    subject: 'Dein Anmeldelink',
    body: (l) =>
      `Tippe, um dich bei MiCole anzumelden:\n\n${l}\n\nDer Link gilt einmal und läuft in 15 Minuten ab.`,
  },
  it: {
    subject: 'Il tuo link di accesso',
    body: (l) => `Tocca per accedere a MiCole:\n\n${l}\n\nIl link funziona una volta e scade tra 15 minuti.`,
  },
  fr: {
    subject: 'Votre lien de connexion',
    body: (l) =>
      `Touchez pour vous connecter à MiCole :\n\n${l}\n\nLe lien fonctionne une fois et expire dans 15 minutes.`,
  },
};
export const magicLinkEmail = (locale: string, link: string) => {
  const c = COPY[locale] ?? COPY.en!;
  return { subject: c.subject, text: c.body(link) };
};
