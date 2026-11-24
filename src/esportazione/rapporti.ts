import { importoImpegnato, scadenzaContrattuale, type VistaAccordo } from '../domain/accordi';
import { invioAvvenuto } from '../domain/stato';
import { etichettaCapitolo, type PdsVista } from '../domain/calcoli';
import { impegnoSulCapitolo } from '../domain/sintesi';
import { euroDaCentesimi } from '../domain/importi';
import type { RigaSintesi, SintesiFinanziaria } from '../domain/sintesi';
import { ELENCO_STATI, STATI, type StatoPds } from '../domain/stato';
import { COLONNE_PDS, colonneSintesi, type ColonnaEsportazione, type Foglio } from './esportazione';
import type { DefinizioneGrafico } from './grafici';

/**
 * Rapporti esportabili: ogni sezione produce i propri fogli di dati e i grafici
 * che ne spiegano l'andamento finanziario.
 */
export interface Rapporto {
  base: string;
  fogli: Foglio<never>[];
  grafici: DefinizioneGrafico[];
}

const euro = (c: number | null | undefined) => (c == null ? null : euroDaCentesimi(c));

/** Colori delle serie, allineati a quelli dei grafici dell'applicazione. */
const COLORI = {
  finanziato: '94A3B8',
  trasmesso: '93C5FD',
  stipulato: '2563EB',
  pagato: '1E3A8A',
  residuo: '16A34A',
  capienza: '64748B',
};

function foglio<T>(nome: string, colonne: ColonnaEsportazione<T>[], righe: T[], totale?: T): Foglio<never> {
  return { nome, colonne, righe, totale } as unknown as Foglio<never>;
}

/** Il grafico si posiziona sotto i dati, lasciando due righe di respiro. */
function sotto(righe: number, conTotale = false): number {
  return righe + (conTotale ? 2 : 1) + 2;
}

// ---------------------------------------------------------------------------
// Elenco dei progetti di spesa
// ---------------------------------------------------------------------------

interface RigaCapitoloPds {
  capitolo: string;
  nPds: number;
  trasmesso: number;
  stipulato: number;
  pagato: number;
}

interface RigaStatoPds {
  stato: string;
  nPds: number;
  impegnato: number;
  pagato: number;
}

const COLONNE_RIEPILOGO_CAPITOLO: ColonnaEsportazione<RigaCapitoloPds>[] = [
  { titolo: 'Capitolo di spesa', tipo: 'testo', larghezza: 18, valore: (r) => r.capitolo },
  { titolo: 'N. PdS', tipo: 'numero', larghezza: 9, valore: (r) => r.nPds },
  { titolo: 'Impegnato (Trasmesso)', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.trasmesso) },
  { titolo: 'Impegnato (Stipulato)', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.stipulato) },
  { titolo: 'Pagato', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.pagato) },
];

const COLONNE_RIEPILOGO_STATO: ColonnaEsportazione<RigaStatoPds>[] = [
  { titolo: 'Stato', tipo: 'testo', larghezza: 18, valore: (r) => r.stato },
  { titolo: 'N. PdS', tipo: 'numero', larghezza: 9, valore: (r) => r.nPds },
  { titolo: 'Impegnato', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.impegnato) },
  { titolo: 'Pagato', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.pagato) },
];

export function rapportoElencoPds(viste: PdsVista[], esercizio: number): Rapporto {
  const perCapitolo = new Map<string, RigaCapitoloPds>();
  for (const v of viste) {
    const codice = v.capitolo ? etichettaCapitolo(v.capitolo, false) : 'senza capitolo';
    const r = perCapitolo.get(codice) ?? { capitolo: codice, nPds: 0, trasmesso: 0, stipulato: 0, pagato: 0 };
    const impegno = impegnoSulCapitolo(v);
    r.nPds += 1;
    r.trasmesso += impegno.trasmesso;
    r.stipulato += impegno.stipulato;
    r.pagato += v.totalePagato;
    perCapitolo.set(codice, r);
  }
  const righeCapitolo = [...perCapitolo.values()].sort((a, b) => a.capitolo.localeCompare(b.capitolo, 'it', { numeric: true }));

  const righeStato: RigaStatoPds[] = ELENCO_STATI.map((stato: StatoPds) => {
    const elenco = viste.filter((v) => v.stato === stato);
    return {
      stato: STATI[stato].etichetta,
      nPds: elenco.length,
      impegnato: elenco.reduce((t, v) => t + importoImpegnato(v), 0),
      pagato: elenco.reduce((t, v) => t + v.totalePagato, 0),
    };
  });

  return {
    base: `elenco_pds_${esercizio}`,
    fogli: [
      foglio('Progetti di spesa', COLONNE_PDS, viste),
      foglio('Riepilogo per capitolo', COLONNE_RIEPILOGO_CAPITOLO, righeCapitolo),
      foglio('Riepilogo per stato', COLONNE_RIEPILOGO_STATO, righeStato),
    ],
    grafici: [
      {
        foglio: 1,
        nomeFoglio: 'Riepilogo per capitolo',
        titolo: `Impegnato e pagato per capitolo · esercizio ${esercizio}`,
        tipo: 'barre',
        categorie: 0,
        serie: [
          { colonna: 2, colore: COLORI.trasmesso },
          { colonna: 3, colore: COLORI.stipulato },
          { colonna: 4, colore: COLORI.pagato },
        ],
        righe: righeCapitolo.length,
        ancoraRiga: sotto(righeCapitolo.length),
      },
      {
        foglio: 2,
        nomeFoglio: 'Riepilogo per stato',
        titolo: 'Progetti di spesa per stato',
        tipo: 'barreOrizzontali',
        categorie: 0,
        serie: [{ colonna: 1, colore: COLORI.stipulato }],
        righe: righeStato.length,
        ancoraRiga: sotto(righeStato.length),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sintesi finanziaria
// ---------------------------------------------------------------------------

/** Resoconto degli incentivi: i PdS impegnati con attività incentivabile. */
const COLONNE_INCENTIVI: ColonnaEsportazione<PdsVista>[] = [
  { titolo: 'Numero PdS', tipo: 'testo', larghezza: 14, valore: (v) => v.numeroCompleto },
  { titolo: 'Stato', tipo: 'testo', larghezza: 16, valore: (v) => STATI[v.stato].etichetta },
  { titolo: 'Capitolo di spesa', tipo: 'testo', larghezza: 36, valore: (v) => (v.capitolo ? etichettaCapitolo(v.capitolo, false) : null) },
  { titolo: 'Ditta', tipo: 'testo', larghezza: 26, valore: (v) => v.pds.ditta },
  { titolo: 'Valore impegnato', tipo: 'importo', larghezza: 16, valore: (v) => euro(importoImpegnato(v)) },
  { titolo: 'Incentivi stanziati', tipo: 'importo', larghezza: 16, valore: (v) => euro(v.incentivi) },
  { titolo: 'Pagato alla ditta', tipo: 'importo', larghezza: 16, valore: (v) => euro(v.totalePagato) },
  { titolo: 'Saldato', tipo: 'testo', larghezza: 8, valore: (v) => (v.pds.saldato ? 'Sì' : 'No') },
];

export function rapportoSintesi(sintesi: SintesiFinanziaria, esercizio: number): Rapporto {
  const righe = sintesi.righe.map((r) => ({ ...r, esercizio: r.capitolo.esercizio, codice: etichettaCapitolo(r.capitolo, false) }));
  const totale = { ...sintesi.totale, esercizio: null, codice: 'TOTALE' };
  const colonne = colonneSintesi();
  const pds = sintesi.righe.flatMap((r) => r.pds);
  // le colonne del foglio sintesi: 0 esercizio, 1 capitolo, 2 finanziato, 3 trasmesso, 5 stipulato, 8 pagato, 11 incentivi, 13 disponibile, 14 residuo
  return {
    base: `sintesi_finanziaria_${esercizio}`,
    fogli: [
      foglio('Sintesi per capitolo', colonne, righe, totale),
      foglio('PdS', COLONNE_PDS, pds),
      foglio('Incentivi', COLONNE_INCENTIVI, pds.filter((v) => v.incentivi > 0 && invioAvvenuto(v.pds))),
    ],
    grafici: [
      // in percentuale del finanziato di ogni capitolo: leggibile anche con importi molto diversi
      {
        foglio: 0,
        nomeFoglio: 'Sintesi per capitolo',
        titolo: `Avanzamento sul finanziato per capitolo · esercizio ${esercizio}`,
        tipo: 'barreOrizzontali',
        categorie: 1,
        serie: [
          { colonna: 4, colore: COLORI.trasmesso },
          { colonna: 6, colore: COLORI.stipulato },
          { colonna: 9, colore: COLORI.pagato },
        ],
        righe: righe.length,
        ancoraRiga: sotto(righe.length, true),
        formatoAsse: '0%',
      },
      {
        foglio: 0,
        nomeFoglio: 'Sintesi per capitolo',
        titolo: `Finanziato, impegnato e pagato per capitolo · esercizio ${esercizio}`,
        tipo: 'barre',
        categorie: 1,
        serie: [
          { colonna: 2, colore: COLORI.finanziato },
          { colonna: 3, colore: COLORI.trasmesso },
          { colonna: 5, colore: COLORI.stipulato },
          { colonna: 8, colore: COLORI.pagato },
        ],
        righe: righe.length,
        ancoraRiga: sotto(righe.length, true) + 20,
      },
      {
        foglio: 0,
        nomeFoglio: 'Sintesi per capitolo',
        titolo: 'Disponibile da impegnare e residuo da pagare',
        tipo: 'barre',
        categorie: 1,
        serie: [
          { colonna: 13, colore: COLORI.residuo },
          { colonna: 14, colore: COLORI.trasmesso },
        ],
        righe: righe.length,
        ancoraRiga: sotto(righe.length, true) + 40,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Capitoli di spesa
// ---------------------------------------------------------------------------

const COLONNE_CAPITOLI: ColonnaEsportazione<RigaSintesi>[] = [
  { titolo: 'Capitolo di spesa', tipo: 'testo', larghezza: 36, valore: (r) => etichettaCapitolo(r.capitolo, false) },
  { titolo: 'Esercizio finanziario', tipo: 'numero', larghezza: 11, valore: (r) => r.capitolo.esercizio },
  { titolo: 'Totale finanziato', tipo: 'importo', larghezza: 17, valore: (r) => euro(r.finanziato) },
  { titolo: 'Impegnato (Trasmesso)', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.inviato) },
  { titolo: 'Impegnato (Stipulato)', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.stipulato) },
  { titolo: 'Pagato', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.pagato) },
  { titolo: 'Incentivi stanziati', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.incentivi) },
  { titolo: 'Disponibile da impegnare', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.disponibileDaImpegnare) },
  { titolo: 'Residuo da pagare', tipo: 'importo', larghezza: 17, valore: (r) => euro(r.residuoDaPagare) },
  { titolo: 'N. PdS', tipo: 'numero', larghezza: 9, valore: (r) => r.nPds },
  { titolo: 'Superamento autorizzato', tipo: 'testo', larghezza: 12, valore: (r) => (r.capitolo.sforamento_ignorato ? 'Sì' : 'No') },
  { titolo: 'Motivazione del superamento', tipo: 'testo', larghezza: 40, valore: (r) => r.capitolo.sforamento_note || null },
];

export function rapportoCapitoli(sintesi: SintesiFinanziaria, esercizio: number): Rapporto {
  return {
    base: `capitoli_di_spesa_${esercizio}`,
    fogli: [foglio('Capitoli di spesa', COLONNE_CAPITOLI, sintesi.righe)],
    grafici: [
      {
        foglio: 0,
        nomeFoglio: 'Capitoli di spesa',
        titolo: `Finanziato, impegnato e pagato · esercizio ${esercizio}`,
        tipo: 'barre',
        categorie: 0,
        serie: [
          { colonna: 2, colore: COLORI.finanziato },
          { colonna: 3, colore: COLORI.trasmesso },
          { colonna: 4, colore: COLORI.stipulato },
          { colonna: 5, colore: COLORI.pagato },
        ],
        righe: sintesi.righe.length,
        ancoraRiga: sotto(sintesi.righe.length),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Accordi quadro
// ---------------------------------------------------------------------------

interface RigaAtto {
  accordo: string;
  atto: string;
  oggetto: string | null;
  importoInviato: number | null;
  protocolloInvio: string | null;
  dataInvio: string | null;
  protocollo: string | null;
  dataStipula: string | null;
  durata: number;
  scadenza: string | null;
  valore: number;
  impegno: number;
  incentivi: number | null;
  ordinato: number;
  residuo: number;
  pagato: number;
  nPds: number;
}

interface RigaOrdinativo {
  accordo: string;
  atto: string;
  vista: PdsVista;
}

const COLONNE_ACCORDI: ColonnaEsportazione<VistaAccordo>[] = [
  { titolo: 'Accordo quadro', tipo: 'testo', larghezza: 16, valore: (v) => v.accordo.numero },
  { titolo: 'Oggetto', tipo: 'testo', larghezza: 40, valore: (v) => v.accordo.oggetto },
  { titolo: 'Ditta', tipo: 'testo', larghezza: 26, valore: (v) => v.accordo.ditta },
  { titolo: 'Collaboratore/DEC', tipo: 'testo', larghezza: 22, valore: (v) => v.accordo.dec },
  { titolo: 'Protocollo di stipula', tipo: 'testo', larghezza: 16, valore: (v) => v.accordo.protocollo_stipula },
  { titolo: 'Data di stipula', tipo: 'data', larghezza: 12, valore: (v) => v.accordo.data_stipula },
  { titolo: 'Durata (giorni)', tipo: 'numero', larghezza: 11, valore: (v) => v.accordo.durata_giorni },
  { titolo: 'Scadenza', tipo: 'data', larghezza: 12, valore: (v) => v.scadenza },
  { titolo: 'Capienza contrattuale', tipo: 'importo', larghezza: 18, valore: (v) => euro(v.accordo.importo) },
  { titolo: 'Impegnato (atti di adesione)', tipo: 'importo', larghezza: 18, valore: (v) => euro(v.impegnatoAtti) },
  { titolo: 'Impegnato (ordinativi diretti)', tipo: 'importo', larghezza: 18, valore: (v) => euro(v.impegnatoDiretto) },
  { titolo: 'Impegnato totale', tipo: 'importo', larghezza: 18, valore: (v) => euro(v.impegnato) },
  { titolo: 'di cui incentivi', tipo: 'importo', larghezza: 16, valore: (v) => euro(v.incentivi) },
  { titolo: 'Residuo ordinabile', tipo: 'importo', larghezza: 18, valore: (v) => euro(v.residuo) },
  { titolo: 'Pagato', tipo: 'importo', larghezza: 16, valore: (v) => euro(v.pagato) },
  { titolo: 'N. ordinativi', tipo: 'numero', larghezza: 10, valore: (v) => v.nPds },
];

const COLONNE_ATTI: ColonnaEsportazione<RigaAtto>[] = [
  { titolo: 'Accordo quadro', tipo: 'testo', larghezza: 16, valore: (r) => r.accordo },
  { titolo: 'Atto di adesione', tipo: 'testo', larghezza: 16, valore: (r) => r.atto },
  { titolo: 'Oggetto', tipo: 'testo', larghezza: 40, valore: (r) => r.oggetto },
  { titolo: 'Importo inviato', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.importoInviato) },
  { titolo: 'Protocollo di invio', tipo: 'testo', larghezza: 16, valore: (r) => r.protocolloInvio },
  { titolo: 'Data di invio', tipo: 'data', larghezza: 12, valore: (r) => r.dataInvio },
  { titolo: 'Protocollo di stipula', tipo: 'testo', larghezza: 16, valore: (r) => r.protocollo },
  { titolo: 'Data di stipula', tipo: 'data', larghezza: 12, valore: (r) => r.dataStipula },
  { titolo: 'Durata (giorni)', tipo: 'numero', larghezza: 11, valore: (r) => r.durata },
  { titolo: 'Scadenza', tipo: 'data', larghezza: 12, valore: (r) => r.scadenza },
  { titolo: 'Valore stipulato', tipo: 'importo', larghezza: 18, valore: (r) => (r.valore ? euro(r.valore) : null) },
  { titolo: 'Capienza impegnata', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.impegno) },
  { titolo: 'di cui incentivi', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.incentivi) },
  { titolo: 'Ordinato', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.ordinato) },
  { titolo: 'Residuo ordinabile', tipo: 'importo', larghezza: 18, valore: (r) => euro(r.residuo) },
  { titolo: 'Pagato', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.pagato) },
  { titolo: 'N. ordinativi', tipo: 'numero', larghezza: 10, valore: (r) => r.nPds },
];

const COLONNE_ORDINATIVI: ColonnaEsportazione<RigaOrdinativo>[] = [
  { titolo: 'Accordo quadro', tipo: 'testo', larghezza: 16, valore: (r) => r.accordo },
  { titolo: 'Atto di adesione', tipo: 'testo', larghezza: 16, valore: (r) => r.atto },
  { titolo: 'Numero PdS', tipo: 'testo', larghezza: 14, valore: (r) => r.vista.numeroCompleto },
  { titolo: 'Stato', tipo: 'testo', larghezza: 16, valore: (r) => STATI[r.vista.stato].etichetta },
  { titolo: 'Ordinativo', tipo: 'testo', larghezza: 18, valore: (r) => r.vista.pds.ordinativo },
  { titolo: 'Capitolo di spesa', tipo: 'testo', larghezza: 36, valore: (r) => (r.vista.capitolo ? etichettaCapitolo(r.vista.capitolo, false) : null) },
  { titolo: 'Ditta', tipo: 'testo', larghezza: 26, valore: (r) => r.vista.pds.ditta },
  { titolo: 'Impegnato', tipo: 'importo', larghezza: 16, valore: (r) => euro(importoImpegnato(r.vista)) },
  { titolo: 'Pagato', tipo: 'importo', larghezza: 16, valore: (r) => euro(r.vista.totalePagato) },
  { titolo: 'Scadenza esecuzione', tipo: 'data', larghezza: 12, valore: (r) => r.vista.scadenza },
];

export function rapportoAccordi(accordi: VistaAccordo[]): Rapporto {
  const atti: RigaAtto[] = accordi.flatMap((a) =>
    a.atti.map((t) => ({
      accordo: a.accordo.numero,
      atto: t.atto.numero,
      oggetto: t.atto.oggetto,
      importoInviato: t.atto.importo_inviato ?? null,
      protocolloInvio: t.atto.protocollo_invio ?? null,
      dataInvio: t.atto.data_invio ?? null,
      protocollo: t.atto.protocollo_stipula,
      dataStipula: t.atto.data_stipula,
      durata: t.atto.durata_giorni,
      scadenza: scadenzaContrattuale(t.atto.data_stipula, t.atto.durata_giorni),
      valore: t.atto.valore,
      impegno: t.valore,
      incentivi: t.atto.incentivabile ? (t.atto.importo_incentivi ?? 0) : null,
      ordinato: t.impegnato,
      residuo: t.residuo,
      pagato: t.pagato,
      nPds: t.pds.length,
    })),
  );
  const ordinativi: RigaOrdinativo[] = accordi.flatMap((a) =>
    a.pds.map((v) => ({
      accordo: a.accordo.numero,
      atto: a.atti.find((t) => t.atto.id === v.pds.atto_adesione_id)?.atto.numero ?? 'quantità determinata',
      vista: v,
    })),
  );

  return {
    base: 'accordi_quadro',
    fogli: [
      foglio('Accordi quadro', COLONNE_ACCORDI, accordi),
      foglio('Atti di adesione', COLONNE_ATTI, atti),
      foglio('Ordinativi', COLONNE_ORDINATIVI, ordinativi),
    ],
    grafici: [
      {
        foglio: 0,
        nomeFoglio: 'Accordi quadro',
        titolo: 'Capienza, impegnato e pagato per accordo quadro',
        tipo: 'barre',
        categorie: 0,
        serie: [
          { colonna: 8, colore: COLORI.capienza },
          { colonna: 11, colore: COLORI.stipulato },
          { colonna: 14, colore: COLORI.pagato },
        ],
        righe: accordi.length,
        ancoraRiga: sotto(accordi.length),
      },
      ...(atti.length
        ? [
            {
              foglio: 1,
              nomeFoglio: 'Atti di adesione',
              titolo: 'Capienza impegnata e ordinato per atto di adesione',
              tipo: 'barre' as const,
              categorie: 1,
              serie: [
                { colonna: 11, colore: COLORI.capienza },
                { colonna: 13, colore: COLORI.stipulato },
                { colonna: 15, colore: COLORI.pagato },
              ],
              righe: atti.length,
              ancoraRiga: sotto(atti.length),
            },
          ]
        : []),
    ],
  };
}
