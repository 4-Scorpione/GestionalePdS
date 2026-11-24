import { confrontoNaturale, etichettaCapitolo, finanziatoCapitolo, type PdsVista } from './calcoli';
import { rapporto } from './importi';
import { invioAvvenuto, stipulaAvvenuta } from './stato';
import type { Capitolo, Centesimi } from './tipi';

/**
 * Impegno del PdS sulla situazione del capitolo: ogni fase sostituisce la precedente.
 * - Inviato: conta l'importo inviato.
 * - Stipulato: conta il valore di stipula, anche nel trasmesso del capitolo.
 * - Saldato: conta il valore di stipula meno l'economia, come se invio e stipula
 *   fossero sempre stati di quel valore.
 * Il singolo PdS conserva comunque i valori di ogni fase.
 */
export function impegnoSulCapitolo(v: PdsVista): { trasmesso: Centesimi; stipulato: Centesimi } {
  const p = v.pds;
  if (stipulaAvvenuta(p)) {
    const economia = p.saldato ? (v.economia ?? 0) : 0;
    return { trasmesso: (p.valore_stipula ?? p.importo_inviato ?? 0) - economia, stipulato: (p.valore_stipula ?? 0) - economia };
  }
  return { trasmesso: invioAvvenuto(p) ? (p.importo_inviato ?? 0) : 0, stipulato: 0 };
}

/**
 * Sintesi finanziaria (sez. 6).
 * - Impegnato (Trasmesso): impegno dei PdS trasmessi, aggiornato al valore di
 *   stipula e, dopo il saldo, al netto dell'economia (vedi `impegnoSulCapitolo`).
 * - Impegnato (Stipulato): impegno dei soli PdS stipulati, al netto delle economie
 *   dei saldati; gli importi dei PdS inviati ma non ancora stipulati sono riportati
 *   a parte ("tra parentesi"). Un PdS scaduto resta conteggiato tra gli stipulati.
 * - Effettivo pagato: somma di tutti i pagamenti registrati.
 * - Incentivi stanziati: quota del valore dei PdS impegnati (trasmessi o
 *   stipulati) riservata agli incentivi. Resta nell'impegnato ma non si paga con
 *   i pagamenti alla ditta: è riportata a parte, accanto al pagato, e non entra
 *   nel residuo da pagare.
 * - Economie: somma delle economie dei PdS saldati (calcolate come stipulato −
 *   incentivi − pagato a saldo, o corrette dall'utente). Sono già tolte
 *   dall'impegnato, quindi tornano nel disponibile da impegnare.
 */
export interface ValoriSintesi {
  finanziato: Centesimi;
  inviato: Centesimi;
  stipulato: Centesimi;
  /** Importi inviati relativi a PdS non ancora stipulati. */
  inviatoNonStipulato: Centesimi;
  pagato: Centesimi;
  /** Quota impegnata per incentivi, non pagata con i pagamenti alla ditta. */
  incentivi: Centesimi;
  /** PdS impegnati con attività incentivabile. */
  nIncentivabili: number;
  economie: Centesimi;
  /** Quanto resta da pagare alla ditta sui PdS stipulati e non ancora saldati (incentivi esclusi). */
  residuoDaPagare: Centesimi;
  /** Importo ancora impegnabile sul capitolo: finanziato − stipulato (già al netto delle economie). */
  disponibileDaImpegnare: Centesimi;
  percInviato: number | null;
  percStipulato: number | null;
  percPagato: number | null;
  /** Pagato rispetto allo stipulato: tende al 100% (meno le economie) a chiusura. */
  percPagatoSuStipulato: number | null;
  sforamentoInviato: Centesimi;
  sforamentoStipulato: Centesimi;
  nPds: number;
  nInPreparazione: number;
  nInviati: number;
  nStipulati: number;
  nSaldati: number;
}

export interface RigaSintesi extends ValoriSintesi {
  capitolo: Capitolo;
  pds: PdsVista[];
}

export interface SintesiFinanziaria {
  righe: RigaSintesi[];
  totale: ValoriSintesi;
  capitoliInSforamento: RigaSintesi[];
}

function completa(
  v: Omit<
    ValoriSintesi,
    'percInviato' | 'percStipulato' | 'percPagato' | 'percPagatoSuStipulato' | 'sforamentoInviato' | 'sforamentoStipulato' | 'disponibileDaImpegnare'
  >,
): ValoriSintesi {
  return {
    ...v,
    disponibileDaImpegnare: v.finanziato - v.stipulato,
    percInviato: rapporto(v.inviato, v.finanziato),
    percStipulato: rapporto(v.stipulato, v.finanziato),
    percPagato: rapporto(v.pagato, v.finanziato),
    percPagatoSuStipulato: rapporto(v.pagato, v.stipulato),
    sforamentoInviato: Math.max(0, v.inviato - v.finanziato),
    sforamentoStipulato: Math.max(0, v.stipulato - v.finanziato),
  };
}

export function valoriCapitolo(finanziato: Centesimi, elenco: PdsVista[]): ValoriSintesi {
  let inviato = 0;
  let stipulato = 0;
  let inviatoNonStipulato = 0;
  let pagato = 0;
  let incentivi = 0;
  let nIncentivabili = 0;
  let economie = 0;
  let residuoDaPagare = 0;
  let nInPreparazione = 0;
  let nInviati = 0;
  let nStipulati = 0;
  let nSaldati = 0;
  for (const v of elenco) {
    const p = v.pds;
    pagato += v.totalePagato;
    const impegno = impegnoSulCapitolo(v);
    if (invioAvvenuto(p)) {
      nInviati++;
      inviato += impegno.trasmesso;
      if (v.incentivi > 0) {
        nIncentivabili++;
        incentivi += v.incentivi;
      }
    } else {
      nInPreparazione++;
    }
    if (stipulaAvvenuta(p)) {
      nStipulati++;
      stipulato += impegno.stipulato;
      if (!p.saldato) residuoDaPagare += Math.max(0, (p.valore_stipula ?? 0) - v.incentivi - v.totalePagato);
    } else if (invioAvvenuto(p)) {
      inviatoNonStipulato += p.importo_inviato ?? 0;
    }
    if (p.saldato) {
      nSaldati++;
      economie += v.economia ?? 0;
    }
  }
  return completa({
    finanziato,
    inviato,
    stipulato,
    inviatoNonStipulato,
    pagato,
    incentivi,
    nIncentivabili,
    economie,
    residuoDaPagare,
    nPds: elenco.length,
    nInPreparazione,
    nInviati,
    nStipulati,
    nSaldati,
  });
}

export function inSforamento(v: Pick<ValoriSintesi, 'sforamentoInviato' | 'sforamentoStipulato'>): boolean {
  return v.sforamentoInviato > 0 || v.sforamentoStipulato > 0;
}

/**
 * Sforamento da segnalare all'utente: l'amministratore può autorizzare il
 * superamento del finanziato di un capitolo, motivandolo nelle note.
 */
export function sforamentoDaSegnalare(r: RigaSintesi): boolean {
  return inSforamento(r) && !r.capitolo.sforamento_ignorato;
}

/**
 * Calcola la sintesi per i capitoli indicati (già filtrati per esercizio).
 * I PdS vengono associati al capitolo tramite `capitolo_id`.
 */
export function calcolaSintesi(capitoli: Capitolo[], viste: PdsVista[]): SintesiFinanziaria {
  const perCapitolo = new Map<string, PdsVista[]>();
  for (const v of viste) {
    const elenco = perCapitolo.get(v.pds.capitolo_id);
    if (elenco) elenco.push(v);
    else perCapitolo.set(v.pds.capitolo_id, [v]);
  }
  const righe: RigaSintesi[] = [...capitoli]
    .sort((a, b) => b.esercizio - a.esercizio || confrontoNaturale(etichettaCapitolo(a, false), etichettaCapitolo(b, false)))
    .map((capitolo) => {
      const pds = perCapitolo.get(capitolo.id) ?? [];
      return { capitolo, pds, ...valoriCapitolo(finanziatoCapitolo(capitolo), pds) };
    });

  const somma = (campo: keyof ValoriSintesi) => righe.reduce((t, r) => t + (r[campo] as number), 0);
  const totale = completa({
    finanziato: somma('finanziato'),
    inviato: somma('inviato'),
    stipulato: somma('stipulato'),
    inviatoNonStipulato: somma('inviatoNonStipulato'),
    pagato: somma('pagato'),
    incentivi: somma('incentivi'),
    nIncentivabili: somma('nIncentivabili'),
    economie: somma('economie'),
    residuoDaPagare: somma('residuoDaPagare'),
    nPds: somma('nPds'),
    nInPreparazione: somma('nInPreparazione'),
    nInviati: somma('nInviati'),
    nStipulati: somma('nStipulati'),
    nSaldati: somma('nSaldati'),
  });
  return { righe, totale, capitoliInSforamento: righe.filter(sforamentoDaSegnalare) };
}
