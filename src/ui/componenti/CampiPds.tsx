import { Autocomplete, Checkbox, MultiSelect, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import { attiDiAccordo, etichettaAtto } from '../../domain/accordi';
import { elencoIdv, eserciziDisponibili, etichettaCapitolo, idvDaElenco } from '../../domain/calcoli';
import { annoDi } from '../../domain/date';
import { puo } from '../../domain/permessi';
import type { AreaPermesso, Centesimi, ID } from '../../domain/tipi';
import { useOggi } from '../../stato/derivati';
import { useApp } from '../../stato/store';
import { CampoImporto } from './campi';

/** Valori dei dati identificativi del PdS, condivisi fra creazione e modifica. */
export interface ValoriIdentificativi {
  numero: string;
  capitolo_id: ID | null;
  accordo_id: ID | null;
  atto_adesione_id: ID | null;
  ditta: string | null;
  idv: string | null;
  dec: string | null;
}

export function useValoriDec(): string[] {
  const pds = useApp((s) => s.dati.pds);
  return useMemo(() => [...new Set(pds.map((p) => p.dec?.trim()).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, 'it')), [pds]);
}

/** Ditte già usate nei PdS e negli accordi quadro, per l'inserimento assistito. */
export function useValoriDitta(): string[] {
  const pds = useApp((s) => s.dati.pds);
  const accordi = useApp((s) => s.dati.accordi);
  return useMemo(() => {
    const tutte = [...pds.map((p) => p.ditta?.trim()), ...accordi.map((a) => a.ditta.trim())];
    return [...new Set(tutte.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, 'it'));
  }, [pds, accordi]);
}

/**
 * Dati identificativi del PdS: numero ed esercizio finanziario si inseriscono
 * separatamente e si leggono insieme ("25/2026"). L'esercizio determina i
 * capitoli selezionabili.
 */
export function CampiIdentificativiPds({
  valori,
  imposta,
  area,
  autofocus = false,
}: {
  valori: ValoriIdentificativi;
  imposta: <C extends keyof ValoriIdentificativi>(campo: C, valore: ValoriIdentificativi[C]) => void;
  /** Permesso richiesto sui capitoli selezionabili. */
  area: Extract<AreaPermesso, 'pds_crea' | 'pds_dati'>;
  autofocus?: boolean;
}) {
  const capitoli = useApp((s) => s.dati.capitoli);
  const accordi = useApp((s) => s.dati.accordi);
  const atti = useApp((s) => s.dati.atti);
  const utente = useApp((s) => s.sessione?.utente);
  const valoriDec = useValoriDec();
  const valoriDitta = useValoriDitta();
  const oggi = useOggi();

  const anni = useMemo(() => eserciziDisponibili({ capitoli }), [capitoli]);
  const annoCapitolo = capitoli.find((c) => c.id === valori.capitolo_id)?.esercizio ?? null;
  const annoPredefinito = annoCapitolo ?? (anni.includes(annoDi(oggi)) ? annoDi(oggi) : (anni[0] ?? annoDi(oggi)));
  const [esercizio, setEsercizio] = useState<number>(annoPredefinito);
  const annoAttivo = annoCapitolo ?? esercizio;

  const opzioniCapitoli = useMemo(
    () =>
      capitoli
        .filter((c) => c.esercizio === annoAttivo)
        .map((c) => ({ value: c.id, label: etichettaCapitolo(c, false), disabled: !puo(utente, area, c) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'it', { numeric: true })),
    [capitoli, annoAttivo, utente, area],
  );

  // Gli IDV si scelgono tra quelli del capitolo (allineati dal SIEFIN); il campo può restare vuoto
  const vociIdv = useMemo(
    () => new Map((capitoli.find((c) => c.id === valori.capitolo_id)?.idv ?? []).map((f) => [f.idv, f.voce])),
    [capitoli, valori.capitolo_id],
  );
  const idvScelti = elencoIdv({ idv: valori.idv ?? null });
  // anche un IDV già registrato ma assente dal capitolo resta visibile, così si può togliere
  const opzioniIdv = [...new Set([...vociIdv.keys(), ...idvScelti])].sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));

  const cambiaCapitolo = (id: ID | null) => {
    imposta('capitolo_id', id);
    // gli IDV di un altro capitolo non valgono più
    const validi = new Set((capitoli.find((c) => c.id === id)?.idv ?? []).map((f) => f.idv));
    imposta('idv', idvDaElenco(idvScelti.filter((x) => validi.has(x))));
  };

  const opzioniAccordi = useMemo(
    () => [...accordi].sort((a, b) => a.numero.localeCompare(b.numero, 'it', { numeric: true })).map((a) => ({ value: a.id, label: `${a.numero} – ${a.oggetto}` })),
    [accordi],
  );
  const opzioniAtti = useMemo(
    () => attiDiAccordo(atti, valori.accordo_id).map((a) => ({ value: a.id, label: etichettaAtto(a) })),
    [atti, valori.accordo_id],
  );

  const cambiaEsercizio = (anno: number) => {
    setEsercizio(anno);
    if (valori.capitolo_id && capitoli.find((c) => c.id === valori.capitolo_id)?.esercizio !== anno) cambiaCapitolo(null);
  };

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
      <TextInput
        label="Numero del progetto di spesa"
        description={valori.numero.trim() ? `Comparirà come ${valori.numero.trim()}/${annoAttivo}` : `Facoltativo: senza numero comparirà come s.n./${annoAttivo}`}
        value={valori.numero}
        onChange={(e) => imposta('numero', e.currentTarget.value.replace(/\D/g, ''))}
        inputMode="numeric"
        maxLength={20}
        data-autofocus={autofocus || undefined}
        classNames={{ input: 'num' }}
      />
      <Select
        label="Esercizio finanziario"
        description="Determina i capitoli selezionabili"
        data={[...new Set([...anni, annoAttivo])].sort((a, b) => b - a).map((a) => ({ value: String(a), label: String(a) }))}
        value={String(annoAttivo)}
        onChange={(x) => x && cambiaEsercizio(Number(x))}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        label="Capitolo di spesa"
        data={opzioniCapitoli}
        value={valori.capitolo_id}
        onChange={cambiaCapitolo}
        searchable
        required
        nothingFoundMessage={`Nessun capitolo per l'esercizio ${annoAttivo}`}
        comboboxProps={{ withinPortal: true }}
      />
      <Autocomplete label="Ditta" data={valoriDitta} value={valori.ditta ?? ''} onChange={(x) => imposta('ditta', x || null)} maxLength={300} comboboxProps={{ withinPortal: true }} />
      <Select
        label="Accordo quadro (eventuale)"
        data={opzioniAccordi}
        value={valori.accordo_id}
        onChange={(x) => {
          imposta('accordo_id', x);
          imposta('atto_adesione_id', null);
        }}
        searchable
        clearable
        nothingFoundMessage="Nessun accordo quadro"
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        label="Atto di adesione a quantità indeterminata"
        description={valori.accordo_id ? 'Il PdS consuma la quota parte dell’atto' : 'Scegliere prima l’accordo quadro'}
        data={opzioniAtti}
        value={valori.atto_adesione_id}
        onChange={(x) => imposta('atto_adesione_id', x)}
        disabled={!valori.accordo_id || opzioniAtti.length === 0}
        clearable
        nothingFoundMessage="Nessun atto di adesione"
        comboboxProps={{ withinPortal: true }}
      />
      <MultiSelect
        label="IDV"
        data={opzioniIdv}
        value={idvScelti}
        onChange={(codici) => imposta('idv', idvDaElenco(codici))}
        renderOption={({ option }) => (
          <div>
            <Text fz="sm">{option.value}</Text>
            {vociIdv.get(option.value) && (
              <Text fz="xs" c="dimmed">
                {vociIdv.get(option.value)}
              </Text>
            )}
          </div>
        )}
        disabled={opzioniIdv.length === 0}
        searchable
        clearable
        comboboxProps={{ withinPortal: true }}
      />
      <Autocomplete label="Collaboratore o DEC" data={valoriDec} value={valori.dec ?? ''} onChange={(x) => imposta('dec', x || null)} maxLength={100} comboboxProps={{ withinPortal: true }} />
    </SimpleGrid>
  );
}

/**
 * Attività incentivabile (PdS e atti di adesione): la quota per incentivi è
 * compresa nel valore, ne impegna una parte e non si paga alla ditta.
 */
export function CampiIncentivi({
  attivo,
  importo,
  setAttivo,
  setImporto,
}: {
  attivo: boolean;
  importo: Centesimi | null;
  setAttivo: (valore: boolean) => void;
  setImporto: (valore: Centesimi | null) => void;
}) {
  return (
    <Stack gap="xs">
      <Checkbox
        label="Attività incentivabile"
        description="Una parte del valore è stanziata per gli incentivi: resta impegnata ma non si paga con i pagamenti alla ditta"
        checked={attivo}
        onChange={(e) => setAttivo(e.currentTarget.checked)}
      />
      {attivo && <CampoImporto label="Importo per incentivi" description="Compreso nel valore complessivo" value={importo} onChange={setImporto} maw={280} />}
    </Stack>
  );
}
