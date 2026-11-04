import type { MockChild } from './templates.js';

/** Invented, anonymised demo content. Names and schools are fictional. */
export function defaultChildren(): MockChild[] {
  return [
    {
      ref: 'child-a',
      name: 'Alumne A',
      school: 'CEIP Exemple',
      classLabel: '3r B',
      sections: {
        circulars: [
          {
            ref: 'circ-1',
            title: 'Sortida al Parc Natural',
            body: "Benvolgudes famílies, el divendres 14 de novembre farem una sortida. Cal retornar l'autorització signada abans del 12/11/2026.",
            sender: 'Direcció',
            postedAt: '2026-11-03T09:00:00+01:00',
            deadline: '12/11/2026',
            attachments: [{ name: 'autoritzacio.pdf', content: '%PDF-1.4 mock' }],
          },
        ],
        missatges: [
          {
            ref: 'msg-1',
            title: 'Reunió de tutoria',
            body: 'Us proposam una reunió el dimarts a les 16 h.',
            sender: 'Tutora 3r B',
            postedAt: '2026-11-02T12:00:00+01:00',
          },
        ],
      },
    },
    {
      ref: 'child-b',
      name: 'Alumne B',
      school: 'CEIP Exemple',
      classLabel: '1r A',
      sections: {
        circulars: [
          {
            ref: 'circ-2',
            title: 'Menú del mes',
            body: 'Adjuntam el menú del menjador de novembre.',
            sender: 'Menjador',
            postedAt: '2026-11-01T08:00:00+01:00',
          },
        ],
      },
    },
  ];
}
