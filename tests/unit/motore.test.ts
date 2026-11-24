import { beforeEach, describe, expect, it } from 'vitest';
import type { Comando } from '../../src/domain/comandi';
import { ErroreApp } from '../../src/domain/errori';
import type { DatiCondivisi, Utente } from '../../src/domain/tipi';
import { PERMESSI_NESSUNO, PERMESSI_TUTTI, datiVuoti } from '../../src/domain/tipi';
import { applicaComando, type ContestoComando, type EsitoMotore } from '../../src/motore/motore';
import { vistePds } from '../../src/domain/calcoli';

const T = '2026-01-01T00:00:00.000Z';
let contatore = 0;

function ctx(utenteId: string): ContestoComando {
  return {
    utenteId,
    ora: '2026-06-01T10:00:00.000Z',
    nuovoId: () => `id-${++contatore}`,
    percorsoFile: (p, a, nome) => `file/${p}/${a}/${nome}`,
  };
}

function utente(id: string, parziale: Partial<Utente> = {}): Utente {
  return {
    id,
    username: id,
    nome: id,
    ruolo: 'utente',
    attivo: true,
    permessi: { ...PERMESSI_NESSUNO },
    created_at: T,
    updated_at: T,
    ...parziale,
  };
}

let dati: DatiCondivisi;

function esegui(utenteId: string, comando: Comando): EsitoMotore {
  const esito = applicaComando(dati, comando, ctx(utenteId));
  dati = esito.dati;
  return esito;
}

function errore(fn: () => unknown): ErroreApp {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErroreApp) return e;
    throw e;
  }
  throw new Error('Nessun errore sollevato');
}

beforeEach(() => {
  contatore = 0;
  dati = {
    ...datiVuoti(),
    utenti: [
      utente('admin', { ruolo: 'admin', permessi: { ...PERMESSI_TUTTI } }),
      utente('operatore', { permessi: { ...PERMESSI_NESSUNO, pds_crea: true, pds_dati: true, pds_pagamenti: true, ambito_capitoli: ['1181'] } }),
      utente('lettore'),
      utente('disattivato', { attivo: false, ruolo: 'admin' }),
    ],
  };
});

function preparaCapitoli() {
  const c1 = esegui('admin', { tipo: 'capitolo.crea', dati: { esercizio: 2026, codice: '1181', descrizione: 'Manutenzione', finanziato: 100_000_00, sforamento_ignorato: false, sforamento_note: '' } }).risultato.id!;
  const c2 = esegui('admin', { tipo: 'capitolo.crea', dati: { esercizio: 2026, codice: '7120', descrizione: 'Impianti', finanziato: 50_000_00, sforamento_ignorato: false, sforamento_note: '' } }).risultato.id!;
  return { c1, c2 };
}

describe('capitoli', () => {
  it("crea capitoli e registra l'operazione", () => {
    const esito = esegui('admin', { tipo: 'capitolo.crea', dati: { esercizio: 2026, codice: ' 1181 ', descrizione: '', finanziato: 500, sforamento_ignorato: false, sforamento_note: '' } });
    expect(dati.capitoli).toHaveLength(1);
    expect(dati.capitoli[0].codice).toBe('1181');
    expect(dati.capitoli[0].created_by).toBe('admin');
    expect(esito.voci).toHaveLength(1);
    expect(esito.voci[0]).toMatchObject({ entita: 'capitolo', azione: 'creazione', username: 'admin', riferimento: '1181 (2026)' });
  });

  it('impedisce duplicati nello stesso esercizio ma li consente in esercizi diversi', () => {
    preparaCapitoli();
    expect(errore(() => esegui('admin', { tipo: 'capitolo.crea', dati: { esercizio: 2026, codice: '1181', descrizione: '', finanziato: 0, sforamento_ignorato: false, sforamento_note: '' } })).codice).toBe('DUPLICATO');
    esegui('admin', { tipo: 'capitolo.crea', dati: { esercizio: 2027, codice: '1181', descrizione: '', finanziato: 0, sforamento_ignorato: false, sforamento_note: '' } });
    expect(dati.capitoli).toHaveLength(3);
  });

  it('nega la gestione dei capitoli a chi non ha il permesso', () => {
    expect(errore(() => esegui('operatore', { tipo: 'capitolo.crea', dati: { esercizio: 2026, codice: '1', descrizione: '', finanziato: 0, sforamento_ignorato: false, sforamento_note: '' } })).codice).toBe('PERMESSO_NEGATO');
    expect(errore(() => esegui('disattivato', { tipo: 'capitolo.crea', dati: { esercizio: 2026, codice: '1', descrizione: '', finanziato: 0, sforamento_ignorato: false, sforamento_note: '' } })).codice).toBe('PERMESSO_NEGATO');
  });

  it('non elimina capitoli con PdS collegati', () => {
    const { c1 } = preparaCapitoli();
    esegui('admin', { tipo: 'pds.crea', dati: { numero: '1', capitolo_id: c1 } });
    expect(errore(() => esegui('admin', { tipo: 'capitolo.elimina', id: c1 })).codice).toBe('VINCOLO');
  });

  it("copia i capitoli su un nuovo esercizio saltando quelli esistenti", () => {
    preparaCapitoli();
    esegui('admin', { tipo: 'capitolo.crea', dati: { esercizio: 2027, codice: '7120', descrizione: '', finanziato: 0, sforamento_ignorato: false, sforamento_note: '' } });
    const esito = esegui('admin', { tipo: 'capitoli.copia', esercizioOrigine: 2026, esercizioDestinazione: 2027, copiaImporti: false });
    expect(esito.risultato.conteggio).toBe(1);
    const nuovo = dati.capitoli.find((c) => c.esercizio === 2027 && c.codice === '1181')!;
    expect(nuovo.finanziato).toBe(0);
    expect(nuovo.descrizione).toBe('Manutenzione');
  });

  it("riserva all'amministratore l'autorizzazione al superamento del finanziato", () => {
    const { c1 } = preparaCapitoli();
    const gestore = utente('gestore', { permessi: { ...PERMESSI_NESSUNO, capitoli: true } });
    dati = { ...dati, utenti: [...dati.utenti, gestore] };
    const modifiche = { sforamento_ignorato: true, sforamento_note: 'Variazione di bilancio richiesta' };
    const originale = { sforamento_ignorato: false, sforamento_note: '' };
    expect(errore(() => esegui('gestore', { tipo: 'capitolo.modifica', id: c1, modifiche, originale })).codice).toBe('PERMESSO_NEGATO');
    const esito = esegui('admin', { tipo: 'capitolo.modifica', id: c1, modifiche, originale });
    expect(dati.capitoli.find((c) => c.id === c1)!.sforamento_ignorato).toBe(true);
    expect(Object.keys(esito.voci[0].modifiche!)).toEqual(['sforamento_ignorato', 'sforamento_note']);
  });

  it('rileva i conflitti di modifica concorrente', () => {
    const { c1 } = preparaCapitoli();
    esegui('admin', { tipo: 'capitolo.modifica', id: c1, modifiche: { finanziato: 1 }, originale: { finanziato: 100_000_00 } });
    const e = errore(() => esegui('admin', { tipo: 'capitolo.modifica', id: c1, modifiche: { finanziato: 2 }, originale: { finanziato: 100_000_00 } }));
    expect(e.codice).toBe('CONFLITTO');
    expect(e.message).toMatch(/Fondi aggiunti manualmente/);
  });
});

describe('PdS', () => {
  it('crea un PdS e normalizza i tempi di esecuzione', () => {
    const { c1 } = preparaCapitoli();
    const id = esegui('operatore', {
      tipo: 'pds.crea',
      dati: { numero: '1', capitolo_id: c1, modalita_termine: 'durata', durata: 30, durata_unita: null, data_termine: '2026-12-31' },
    }).risultato.id!;
    const p = dati.pds.find((x) => x.id === id)!;
    expect(p.durata_unita).toBe('giorni');
    expect(p.data_termine).toBeNull();
    expect(p.saldato).toBe(false);
  });

  it('il numero del PdS è facoltativo, il capitolo no', () => {
    const { c1 } = preparaCapitoli();
    const id = esegui('admin', { tipo: 'pds.crea', dati: { numero: '', capitolo_id: c1 } }).risultato.id!;
    expect(vistePds(dati, '2026-06-01', 30).find((v) => v.pds.id === id)!.numeroCompleto).toBe('s.n./2026');
    const senzaCapitolo = { tipo: 'pds.crea', dati: { numero: '3', capitolo_id: '' } } as Comando;
    expect(errore(() => esegui('admin', senzaCapitolo)).codice).toBe('VALIDAZIONE');
  });

  it("rispetta l'ambito dei capitoli assegnati", () => {
    const { c1, c2 } = preparaCapitoli();
    expect(errore(() => esegui('operatore', { tipo: 'pds.crea', dati: { numero: '7', capitolo_id: c2 } })).codice).toBe('PERMESSO_NEGATO');
    const id = esegui('operatore', { tipo: 'pds.crea', dati: { numero: '7', capitolo_id: c1 } }).risultato.id!;
    // spostare il PdS su un capitolo fuori ambito non è consentito
    const e = errore(() => esegui('operatore', { tipo: 'pds.modifica', id, modifiche: { capitolo_id: c2 }, originale: { capitolo_id: c1 } }));
    expect(e.codice).toBe('PERMESSO_NEGATO');
    expect(errore(() => esegui('lettore', { tipo: 'pds.modifica', id, modifiche: { note: 'x' }, originale: { note: null } })).codice).toBe('PERMESSO_NEGATO');
  });

  it('registra solo i campi effettivamente modificati', () => {
    const { c1 } = preparaCapitoli();
    const id = esegui('admin', { tipo: 'pds.crea', dati: { numero: '1', capitolo_id: c1 } }).risultato.id!;
    const esito = esegui('admin', {
      tipo: 'pds.modifica',
      id,
      modifiche: { numero: '1', data_stipula: '2026-02-01', valore_stipula: 1000 },
      originale: { numero: '1', data_stipula: null, valore_stipula: null },
    });
    expect(Object.keys(esito.voci[0].modifiche!)).toEqual(['data_stipula', 'valore_stipula']);
    expect(esito.voci[0].modifiche!.valore_stipula).toEqual({ da: null, a: 1000 });
    const nessuna = esegui('admin', { tipo: 'pds.modifica', id, modifiche: { numero: '1' }, originale: { numero: '1' } });
    expect(nessuna.voci).toHaveLength(0);
  });

  it('non consente di toccare i campi del saldo con la modifica ordinaria', () => {
    const { c1 } = preparaCapitoli();
    const id = esegui('admin', { tipo: 'pds.crea', dati: { numero: '1', capitolo_id: c1 } }).risultato.id!;
    const comando = { tipo: 'pds.modifica', id, modifiche: { saldato: true }, originale: {} } as unknown as Comando;
    expect(errore(() => esegui('admin', comando)).codice).toBe('VALIDAZIONE');
  });

  it('sposta il PdS tra gli eliminati conservando pagamenti e allegati', () => {
    const { c1 } = preparaCapitoli();
    const id = esegui('admin', { tipo: 'pds.crea', dati: { numero: '1', capitolo_id: c1 } }).risultato.id!;
    esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-03-01', importo: 100, riferimento: null, note: null } });
    const file = { nome: 'fattura.pdf', tipo: 'application/pdf', dimensione: 3, contenuto: new Blob(['abc']) };
    esegui('admin', { tipo: 'allegato.crea', pds_id: id, dati: { tipo: 'fattura', titolo: 'Fattura 1', url: null }, file });
    const esito = esegui('operatore', { tipo: 'pds.elimina', id });
    const p = dati.pds.find((x) => x.id === id)!;
    expect(p.eliminato_at).toBe('2026-06-01T10:00:00.000Z');
    expect(p.eliminato_da).toBe('operatore');
    expect(dati.pagamenti).toHaveLength(1);
    expect(dati.allegati).toHaveLength(1);
    expect(esito.effetti).toEqual([]);
    expect(Object.keys(esito.voci[0].modifiche!)).toEqual(['eliminato_at', 'eliminato_da']);
    // finché resta tra gli eliminati non è modificabile
    expect(errore(() => esegui('admin', { tipo: 'pds.modifica', id, modifiche: { note: 'x' }, originale: { note: null } })).codice).toBe('VINCOLO');
    expect(errore(() => esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-04-01', importo: 1, riferimento: null, note: null } })).codice).toBe('VINCOLO');
  });

  it('solo l\u2019amministratore ripristina o elimina definitivamente un PdS eliminato', () => {
    const { c1 } = preparaCapitoli();
    const id = esegui('admin', { tipo: 'pds.crea', dati: { numero: '1', capitolo_id: c1 } }).risultato.id!;
    const file = { nome: 'fattura.pdf', tipo: 'application/pdf', dimensione: 3, contenuto: new Blob(['abc']) };
    esegui('admin', { tipo: 'allegato.crea', pds_id: id, dati: { tipo: 'fattura', titolo: 'Fattura 1', url: null }, file });
    esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-03-01', importo: 100, riferimento: null, note: null } });
    // non ancora eliminato: nessun ripristino e nessuna eliminazione definitiva
    expect(errore(() => esegui('admin', { tipo: 'pds.ripristina', id })).codice).toBe('VINCOLO');
    expect(errore(() => esegui('admin', { tipo: 'pds.elimina_definitivo', id })).codice).toBe('VINCOLO');
    esegui('operatore', { tipo: 'pds.elimina', id });
    expect(errore(() => esegui('operatore', { tipo: 'pds.ripristina', id })).codice).toBe('PERMESSO_NEGATO');
    expect(errore(() => esegui('operatore', { tipo: 'pds.elimina_definitivo', id })).codice).toBe('PERMESSO_NEGATO');
    esegui('admin', { tipo: 'pds.ripristina', id });
    expect(dati.pds.find((x) => x.id === id)!.eliminato_at).toBeNull();
    esegui('operatore', { tipo: 'pds.elimina', id });
    const esito = esegui('admin', { tipo: 'pds.elimina_definitivo', id });
    expect(dati.pds).toHaveLength(0);
    expect(dati.pagamenti).toHaveLength(0);
    expect(dati.allegati).toHaveLength(0);
    expect(esito.effetti).toEqual([{ tipo: 'file.elimina', path: expect.stringMatching(/^file\/.+\/fattura\.pdf$/) }]);
  });
});

describe('pagamenti e saldo', () => {
  function preparaPdsStipulato() {
    const { c1 } = preparaCapitoli();
    const id = esegui('admin', {
      tipo: 'pds.crea',
      dati: { numero: '1', capitolo_id: c1, data_stipula: '2026-02-01', valore_stipula: 10_000_00, importo_inviato: 10_500_00, data_invio: '2026-01-15' },
    }).risultato.id!;
    return id;
  }

  it('il pagamento a saldo chiude il PdS registrando il totale pagato', () => {
    const id = preparaPdsStipulato();
    esegui('operatore', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-03-01', importo: 4_000_00, riferimento: '0000101', note: null, fattura: 'FT 12/2026' } });
    const esito = esegui('operatore', {
      tipo: 'pagamento.crea',
      pds_id: id,
      dati: { data: '2026-05-10', importo: 5_800_00, riferimento: '0000102', note: null, saldo: true },
    });
    const p = dati.pds.find((x) => x.id === id)!;
    expect(p.saldato).toBe(true);
    expect(p.data_saldo).toBe('2026-05-10');
    expect(p.totale_pagato_saldo).toBe(9_800_00);
    expect(dati.pagamenti.map((k) => k.fattura)).toEqual(['FT 12/2026', null]);
    expect(esito.voci.map((v) => `${v.entita}:${v.azione}`)).toEqual(['pagamento:creazione', 'pds:modifica']);
  });

  it('segnare a saldo un pagamento già registrato chiude il PdS', () => {
    const id = preparaPdsStipulato();
    const pag = esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-03-01', importo: 10_000_00, riferimento: null, note: null } }).risultato.id!;
    esegui('admin', { tipo: 'pagamento.modifica', id: pag, modifiche: { saldo: true }, originale: { saldo: false } });
    expect(dati.pds.find((x) => x.id === id)!.saldato).toBe(true);
  });

  it('blocca i pagamenti sui PdS saldati finché il saldo non è annullato', () => {
    const id = preparaPdsStipulato();
    esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-05-10', importo: 9_000_00, riferimento: null, note: null, saldo: true } });
    const pag = { data: '2026-05-11', importo: 1, riferimento: null, note: null };
    expect(errore(() => esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: pag })).codice).toBe('VINCOLO');
    expect(errore(() => esegui('admin', { tipo: 'saldo.conferma', pds_id: id, data_saldo: '2026-05-10' })).codice).toBe('VINCOLO');
    esegui('admin', { tipo: 'saldo.annulla', pds_id: id });
    // il pagamento a saldo torna ordinario e se ne possono registrare altri
    expect(dati.pagamenti[0].saldo).toBe(false);
    esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: pag });
    const p = dati.pds.find((x) => x.id === id)!;
    expect(p.saldato).toBe(false);
    expect(p.totale_pagato_saldo).toBeNull();
  });

  it('chiude il PdS anche senza un nuovo pagamento, ma solo dopo la stipula', () => {
    const id = preparaPdsStipulato();
    esegui('admin', { tipo: 'saldo.conferma', pds_id: id, data_saldo: '2026-05-10' });
    expect(dati.pds.find((x) => x.id === id)!.totale_pagato_saldo).toBe(0);
    const id2 = esegui('admin', { tipo: 'pds.crea', dati: { numero: '2', capitolo_id: dati.capitoli[0].id } }).risultato.id!;
    expect(errore(() => esegui('admin', { tipo: 'saldo.conferma', pds_id: id2, data_saldo: '2026-05-10' })).codice).toBe('VINCOLO');
    const pag = { data: '2026-05-10', importo: 1, riferimento: null, note: null, saldo: true };
    expect(errore(() => esegui('admin', { tipo: 'pagamento.crea', pds_id: id2, dati: pag })).codice).toBe('VINCOLO');
  });

  it("calcola l'economia al netto degli incentivi e la lascia correggere dopo il saldo", () => {
    const id = preparaPdsStipulato();
    esegui('admin', { tipo: 'pds.modifica', id, modifiche: { incentivabile: true, importo_incentivi: 200_00 }, originale: {} });
    expect(errore(() => esegui('admin', { tipo: 'saldo.economia', pds_id: id, economia: 1, note: null })).codice).toBe('VINCOLO');
    esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-05-10', importo: 9_000_00, riferimento: null, note: null, saldo: true } });
    const viste = () => vistePds(dati, '2026-06-01', 30).find((v) => v.pds.id === id)!;
    // 10.000 stipulati − 200 di incentivi − 9.000 pagati
    expect(viste().economia).toBe(800_00);
    esegui('admin', { tipo: 'saldo.economia', pds_id: id, economia: 500_00, note: 'Penale trattenuta' });
    expect(viste().economia).toBe(500_00);
    expect(dati.pds.find((x) => x.id === id)!.economia_note).toBe('Penale trattenuta');
    esegui('admin', { tipo: 'saldo.economia', pds_id: id, economia: null, note: null });
    expect(viste().economia).toBe(800_00);
    expect(errore(() => esegui('lettore', { tipo: 'saldo.economia', pds_id: id, economia: 1, note: null })).codice).toBe('PERMESSO_NEGATO');
  });

  it('conserva i dati del titolo di spesa solo per i PdS con DAC', () => {
    const id = preparaPdsStipulato();
    const titolo = { codice_titolo: 'T1', codice_memoriale: 'M1', data_titolo: '2026-03-02' };
    esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-03-01', importo: 1_00, riferimento: null, note: null, ...titolo } });
    expect(dati.pagamenti[0].codice_titolo).toBeNull();
    esegui('admin', { tipo: 'pds.modifica', id, modifiche: { dac: true, protocollo_dac: '0000555', data_dac: '2026-01-10', atto_dispositivo: 'AD 3/2026' }, originale: {} });
    esegui('admin', { tipo: 'pagamento.crea', pds_id: id, dati: { data: '2026-03-05', importo: 1_00, riferimento: null, note: null, ...titolo } });
    expect(dati.pagamenti[1]).toMatchObject(titolo);
    // togliendo la DAC i suoi dati si svuotano
    esegui('admin', { tipo: 'pds.modifica', id, modifiche: { dac: false }, originale: {} });
    expect(dati.pds.find((x) => x.id === id)).toMatchObject({ dac: false, protocollo_dac: null, data_dac: null, atto_dispositivo: null });
  });

  it('nega i pagamenti a chi non ha il permesso', () => {
    const id = preparaPdsStipulato();
    const pag = { data: '2026-05-11', importo: 1, riferimento: null, note: null };
    expect(errore(() => esegui('lettore', { tipo: 'pagamento.crea', pds_id: id, dati: pag })).codice).toBe('PERMESSO_NEGATO');
  });
});

describe('utenti', () => {
  it("consente la gestione utenti solo all'amministratore", () => {
    const nuovo = { username: 'Mario.Rossi', nome: 'Mario Rossi', ruolo: 'utente' as const, attivo: true, permessi: { ...PERMESSI_NESSUNO } };
    expect(errore(() => esegui('operatore', { tipo: 'utente.crea', dati: nuovo, password: 'password2026' })).codice).toBe('PERMESSO_NEGATO');
    const esito = esegui('admin', { tipo: 'utente.crea', dati: nuovo, password: 'password2026' });
    expect(dati.utenti.find((u) => u.id === esito.risultato.id)!.username).toBe('mario.rossi');
    expect(esito.effetti[0]).toMatchObject({ tipo: 'credenziali.imposta', password: 'password2026' });
    expect(errore(() => esegui('admin', { tipo: 'utente.crea', dati: nuovo, password: 'password2026' })).codice).toBe('DUPLICATO');
  });

  it("mantiene almeno un amministratore attivo", () => {
    expect(errore(() => esegui('admin', { tipo: 'utente.modifica', id: 'admin', modifiche: { ruolo: 'utente' } })).codice).toBe('VINCOLO');
    expect(errore(() => esegui('admin', { tipo: 'utente.elimina', id: 'admin' })).codice).toBe('VINCOLO');
    esegui('admin', { tipo: 'utente.modifica', id: 'operatore', modifiche: { ruolo: 'admin' } });
    esegui('admin', { tipo: 'utente.modifica', id: 'admin', modifiche: { attivo: false } });
    expect(dati.utenti.find((u) => u.id === 'admin')!.attivo).toBe(false);
  });

  it('rifiuta password deboli', () => {
    expect(errore(() => esegui('admin', { tipo: 'utente.password', id: 'lettore', password: 'corta' })).codice).toBe('VALIDAZIONE');
  });
});
