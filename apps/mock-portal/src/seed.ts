import type { MockChild } from './templates.js';

/** A real one-page PDF so the in-app viewer can be tested. */
const DEMO_PDF = "%PDF-1.4\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>\nendobj\n4 0 obj\n<</Length 50>>\nstream\nBT /F1 28 Tf 72 760 Td (Autoritzacio - demo) Tj ET\nendstream\nendobj\n5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000054 00000 n \n0000000105 00000 n \n0000000217 00000 n \n0000000315 00000 n \ntrailer\n<</Size 6/Root 1 0 R>>\nstartxref\n378\n%%EOF\n";

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
            attachments: [{ name: 'autoritzacio.pdf', content: DEMO_PDF }],
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
          {
            // Long official sender with accents, an apostrophe and a double space (as seen in GestIB).
            ref: 'msg-2',
            title: 'Beques per a estudis postobligatoris',
            body: 'Informació sobre les beques del curs vinent: https://www.caib.es/beques',
            sender: "DIRECCIÓ GENERAL  D'UNIVERSITATS, RECERCA I ENSENYAMENTS ARTÍSTICS SUPERIORS",
            postedAt: '2026-06-10T10:00:00+02:00',
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
