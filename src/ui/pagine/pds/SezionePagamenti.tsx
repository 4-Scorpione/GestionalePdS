import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Divider, Group, Modal, SimpleGrid, Stack, Table, Text, Textarea, TextInput, ThemeIcon, Tooltip } from '@mantine/core';
import { IconCash, IconCircleCheck, IconLockOpen, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { economiaCalcolata, type PdsVista } from '../../../domain/calcoli';
import type { DatiPagamento } from '../../../domain/comandi';
import { formattaData, oggiISO } from '../../../domain/date';
import { formattaEuro, formattaPercentuale } from '../../../domain/importi';
import { puo } from '../../../domain/permessi';
import { stipulaAvvenuta } from '../../../domain/stato';
import type { Centesimi, DataISO, Pagamento } from '../../../domain/tipi';
import { useApp } from '../../../stato/store';
import { chiediConferma, useAzione } from '../../componenti/azioni';
import { Importo, Meter, Protocollo } from '../../componenti/base';
import { CampoData, CampoImporto, CampoProtocollo } from '../../componenti/campi';

const CAMPI_PAGAMENTO = ['data', 'importo', 'riferimento', 'fattura', 'saldo', 'codice_titolo', 'codice_memoriale', 'data_titolo', 'note'] as const;

/** Riepilogo di totale finale ed economia che il saldo registrerà. */
function AnteprimaSaldo({ vista, totaleFinale }: { vista: PdsVista; totaleFinale: Centesimi }) {
  const economia = (vista.pds.valore_stipula ?? 0) - vista.incentivi - totaleFinale;
  return (
    <Card withBorder padding="sm" bg="var(--mantine-color-default-hover)">
      <SimpleGrid cols={2} spacing="xs">
        <div>
          <Text fz="xs" c="dimmed">
            Valore complessivo finale pagato
          </Text>
          <Text fw={700} className="num">
            {formattaEuro(totaleFinale)}
          </Text>
        </div>
        <div>
          <Text fz="xs" c="dimmed">
            Economia{vista.incentivi > 0 ? ' (al netto degli incentivi)' : ''}
          </Text>
          <Text fw={700} className="num" c={economia < 0 ? 'red.7' : undefined}>
            {formattaEuro(economia)}
          </Text>
        </div>
      </SimpleGrid>
      <Text fz="xs" c={economia < 0 ? 'red.7' : 'dimmed'} mt={4}>
        {economia < 0
          ? 'Il pagato supera il valore stipulato al netto degli incentivi.'
          : "Dopo il saldo l'economia si può correggere e motivare con delle note."}
      </Text>
    </Card>
  );
}

function ModalePagamento({ vista, pagamento, onClose }: { vista: PdsVista; pagamento: Pagamento | 'nuovo'; onClose: () => void }) {
  const esistente = pagamento === 'nuovo' ? null : pagamento;
  const p = vista.pds;
  const [data, setData] = useState<DataISO | null>(esistente?.data ?? oggiISO());
  const [importo, setImporto] = useState<Centesimi | null>(esistente?.importo ?? null);
  const [riferimento, setRiferimento] = useState<string | null>(esistente?.riferimento ?? null);
  const [fattura, setFattura] = useState(esistente?.fattura ?? '');
  const [saldo, setSaldo] = useState(false);
  const [codiceTitolo, setCodiceTitolo] = useState(esistente?.codice_titolo ?? '');
  const [codiceMemoriale, setCodiceMemoriale] = useState(esistente?.codice_memoriale ?? '');
  const [dataTitolo, setDataTitolo] = useState<DataISO | null>(esistente?.data_titolo ?? null);
  const [note, setNote] = useState(esistente?.note ?? '');
  const { inCorso, esegui } = useAzione();
  const saldoPossibile = stipulaAvvenuta(p) && p.valore_stipula != null;
  const altriPagamenti = vista.totalePagato - (esistente?.importo ?? 0);

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    if (!data || !importo) return;
    const dati: DatiPagamento = {
      data,
      importo,
      riferimento,
      fattura: fattura.trim() || null,
      saldo,
      ...(p.dac ? { codice_titolo: codiceTitolo.trim() || null, codice_memoriale: codiceMemoriale.trim() || null, data_titolo: dataTitolo } : {}),
      note: note.trim() || null,
    };
    const ok = await esegui(async () => {
      if (esistente) {
        const modifiche: Partial<DatiPagamento> = {};
        const originale: Partial<DatiPagamento> = {};
        for (const k of CAMPI_PAGAMENTO) {
          if (k in dati && (dati[k] ?? null) !== (esistente[k] ?? null)) {
            (modifiche as Record<string, unknown>)[k] = dati[k];
            (originale as Record<string, unknown>)[k] = esistente[k];
          }
        }
        if (Object.keys(modifiche).length) await useApp.getState().esegui({ tipo: 'pagamento.modifica', id: esistente.id, modifiche, originale });
      } else {
        await useApp.getState().esegui({ tipo: 'pagamento.crea', pds_id: p.id, dati });
      }
      return true;
    }, saldo ? `Pagamento a saldo registrato: PdS ${vista.numeroCompleto} saldato.` : esistente ? 'Pagamento aggiornato.' : 'Pagamento registrato.');
    if (ok) onClose();
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>{esistente ? 'Modifica pagamento' : 'Registra pagamento'}</Text>} size="lg">
      <form onSubmit={invia}>
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
            <TextInput label="Fattura" description="Numero della fattura" value={fattura} onChange={(e) => setFattura(e.currentTarget.value)} maxLength={50} data-autofocus />
            <CampoProtocollo label="Numero di protocollo" description="Solo il numero: la data è quella del pagamento" value={riferimento} onChange={setRiferimento} />
            <CampoImporto label="Importo" value={importo} onChange={setImporto} required />
            <CampoData label="Data del pagamento" value={data} onChange={setData} required clearable={false} />
          </SimpleGrid>
          {p.dac && (
            <>
              <Divider label="Titolo di spesa (PdS con DAC)" labelPosition="left" />
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                <TextInput label="Codice titolo" value={codiceTitolo} onChange={(e) => setCodiceTitolo(e.currentTarget.value)} maxLength={50} />
                <TextInput label="Codice memoriale" value={codiceMemoriale} onChange={(e) => setCodiceMemoriale(e.currentTarget.value)} maxLength={50} />
                <CampoData label="Data titolo" value={dataTitolo} onChange={setDataTitolo} />
              </SimpleGrid>
            </>
          )}
          <TextInput label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={300} />
          <Checkbox
            label="Pagamento a saldo"
            description={saldoPossibile ? "È l'ultimo pagamento del PdS: alla registrazione il PdS risulta saldato" : 'Disponibile dopo la stipula (data e valore)'}
            checked={saldo}
            onChange={(e) => setSaldo(e.currentTarget.checked)}
            disabled={!saldoPossibile}
          />
          {saldo && <AnteprimaSaldo vista={vista} totaleFinale={altriPagamenti + (importo ?? 0)} />}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" loading={inCorso} disabled={!data || !importo} color={saldo ? 'green' : undefined}>
              {saldo ? 'Salva e conferma il saldo' : 'Salva'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Chiusura del PdS senza un nuovo pagamento: ultimo pagamento già registrato o PdS non eseguito. */
function ModaleSaldo({ vista, onClose }: { vista: PdsVista; onClose: () => void }) {
  const p = vista.pds;
  const [dataSaldo, setDataSaldo] = useState<DataISO | null>(oggiISO());
  const { inCorso, esegui } = useAzione();

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    if (!dataSaldo) return;
    const ok = await esegui(
      () => useApp.getState().esegui({ tipo: 'saldo.conferma', pds_id: p.id, data_saldo: dataSaldo }),
      `Saldo del PdS ${vista.numeroCompleto} confermato.`,
    );
    if (ok) onClose();
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>Conferma saldo – PdS {vista.numeroCompleto}</Text>} size="lg">
      <form onSubmit={invia}>
        <Stack gap="sm">
          <Text fz="sm">
            Di norma il saldo si conferma registrando l'ultimo pagamento come «Pagamento a saldo». Qui il PdS si chiude senza un nuovo pagamento, per esempio se
            l'ultimo è già registrato o se il PdS non è stato eseguito. I pagamenti non saranno più modificabili, salvo annullamento del saldo.
          </Text>
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
            <div>
              <Text fz="xs" c="dimmed">
                Valore stipulato
              </Text>
              <Importo valore={p.valore_stipula} forte />
            </div>
            <div>
              <Text fz="xs" c="dimmed">
                Pagamenti già registrati ({vista.pagamenti.length})
              </Text>
              <Importo valore={vista.totalePagato} forte />
            </div>
          </SimpleGrid>
          <CampoData label="Data del saldo" value={dataSaldo} onChange={setDataSaldo} required clearable={false} maw={240} />
          <AnteprimaSaldo vista={vista} totaleFinale={vista.totalePagato} />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" color="green" loading={inCorso} disabled={!dataSaldo} leftSection={<IconCircleCheck size={16} />}>
              Conferma saldo
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Correzione dell'economia dopo il saldo: si parte dal valore calcolato. */
function ModaleEconomia({ vista, onClose }: { vista: PdsVista; onClose: () => void }) {
  const p = vista.pds;
  const calcolata = economiaCalcolata(p);
  const [importo, setImporto] = useState<Centesimi | null>(vista.economia != null && vista.economia >= 0 ? vista.economia : null);
  const [note, setNote] = useState(p.economia_note ?? '');
  const { inCorso, esegui } = useAzione();

  const salva = async (economia: Centesimi | null, testo: string | null, messaggio: string) => {
    const ok = await esegui(() => useApp.getState().esegui({ tipo: 'saldo.economia', pds_id: p.id, economia, note: testo }), messaggio);
    if (ok) onClose();
  };

  const invia = (e: FormEvent) => {
    e.preventDefault();
    // l'importo uguale al calcolato non è una correzione: resta calcolato e segue eventuali variazioni degli incentivi
    void salva(importo === calcolata ? null : importo, note.trim() || null, 'Economia aggiornata.');
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>Economia – PdS {vista.numeroCompleto}</Text>}>
      <form onSubmit={invia}>
        <Stack gap="sm">
          <Text fz="sm">
            Economia calcolata: {formattaEuro(calcolata)} (valore stipulato − incentivi − totale pagato a saldo). Si può correggere e motivare.
          </Text>
          <CampoImporto label="Economia" value={importo} onChange={setImporto} required data-autofocus />
          <Textarea label="Note esplicative" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2} maxRows={8} maxLength={5000} />
          <Group justify="space-between" mt="sm">
            <Button variant="subtle" onClick={() => salva(null, note.trim() || null, 'Economia riportata al valore calcolato.')} disabled={inCorso || p.economia_importo == null}>
              Torna al valore calcolato
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Annulla
              </Button>
              <Button type="submit" loading={inCorso} disabled={importo == null}>
                Salva
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function SezionePagamenti({ vista }: { vista: PdsVista }) {
  const utente = useApp((s) => s.sessione?.utente);
  const p = vista.pds;
  const puoPagamenti = puo(utente, 'pds_pagamenti', vista.capitolo);
  const [modale, setModale] = useState<Pagamento | 'nuovo' | null>(null);
  const [saldoAperto, setSaldoAperto] = useState(false);
  const [economiaAperta, setEconomiaAperta] = useState(false);
  const { inCorso, esegui } = useAzione();

  const elimina = async (pag: Pagamento) => {
    const ok = await chiediConferma({
      titolo: 'Eliminare il pagamento?',
      messaggio: `Il pagamento di ${formattaEuro(pag.importo)} del ${formattaData(pag.data)} sarà eliminato.`,
      conferma: 'Elimina',
      pericolosa: true,
    });
    if (ok) await esegui(() => useApp.getState().esegui({ tipo: 'pagamento.elimina', id: pag.id }), 'Pagamento eliminato.');
  };

  const annullaSaldo = async () => {
    const ok = await chiediConferma({
      titolo: 'Annullare il saldo?',
      messaggio:
        "Il PdS tornerà aperto: i pagamenti diventeranno di nuovo modificabili, il pagamento a saldo tornerà ordinario e il valore finale e l'economia registrati saranno rimossi.",
      conferma: 'Annulla saldo',
      pericolosa: true,
    });
    if (ok) await esegui(() => useApp.getState().esegui({ tipo: 'saldo.annulla', pds_id: p.id }), 'Saldo annullato.');
  };

  // gli incentivi non si pagano alla ditta: il residuo è al netto
  const residuo = p.valore_stipula != null && stipulaAvvenuta(p) ? p.valore_stipula - vista.incentivi - vista.totalePagato : null;
  const modificabili = puoPagamenti && !p.saldato;
  const colonne = 5 + (p.dac ? 1 : 0) + (modificabili ? 1 : 0);

  return (
    <Card style={{ gridColumn: '1 / -1' }}>
      <Group justify="space-between" mb="md" gap="xs">
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon variant="light" size={30} radius="md">
            <IconCash size={18} />
          </ThemeIcon>
          <Text fw={600} component="h3" m={0} fz="md">
            Pagamenti e saldo
          </Text>
        </Group>
        {puoPagamenti && (
          <Group gap="xs" className="no-stampa">
            {!p.saldato && (
              <Button variant="light" size="compact-sm" leftSection={<IconPlus size={14} />} onClick={() => setModale('nuovo')}>
                Registra pagamento
              </Button>
            )}
            {!p.saldato && (
              <Tooltip
                label={
                  stipulaAvvenuta(p) && p.valore_stipula != null
                    ? 'Chiude il PdS senza un nuovo pagamento: di norma il saldo si conferma con il «Pagamento a saldo»'
                    : 'Per confermare il saldo occorre la stipula (data e valore)'
                }
              >
                <Button
                  variant="subtle"
                  color="green"
                  size="compact-sm"
                  leftSection={<IconCircleCheck size={14} />}
                  onClick={() => setSaldoAperto(true)}
                  disabled={!stipulaAvvenuta(p) || p.valore_stipula == null}
                >
                  Conferma saldo
                </Button>
              </Tooltip>
            )}
            {p.saldato && (
              <Button variant="subtle" color="red" size="compact-sm" leftSection={<IconLockOpen size={14} />} onClick={annullaSaldo} loading={inCorso}>
                Annulla saldo
              </Button>
            )}
          </Group>
        )}
      </Group>

      {p.saldato && (
        <Alert color="green" variant="light" icon={<IconCircleCheck size={18} />} mb="md" title={`Saldo confermato il ${formattaData(p.data_saldo)}`}>
          <Group gap="xl" align="flex-start">
            <div>
              <Text fz="xs" c="dimmed">
                Valore complessivo finale pagato
              </Text>
              <Importo valore={p.totale_pagato_saldo} forte />
            </div>
            <div>
              <Text fz="xs" c="dimmed">
                Valore stipulato
              </Text>
              <Importo valore={p.valore_stipula} />
            </div>
            {vista.incentivi > 0 && (
              <div>
                <Text fz="xs" c="dimmed">
                  Incentivi stanziati
                </Text>
                <Importo valore={vista.incentivi} />
              </div>
            )}
            <div>
              <Group gap={6}>
                <Text fz="xs" c="dimmed">
                  Economia
                </Text>
                {p.economia_importo != null && (
                  <Badge size="xs" variant="light" color="gray">
                    corretta
                  </Badge>
                )}
              </Group>
              <Group gap={4} wrap="nowrap">
                <Importo valore={vista.economia} forte c={vista.economia != null && vista.economia < 0 ? 'red.7' : undefined} />
                {puoPagamenti && (
                  <ActionIcon variant="subtle" size="sm" onClick={() => setEconomiaAperta(true)} aria-label="Modifica l'economia" className="no-stampa">
                    <IconPencil size={14} />
                  </ActionIcon>
                )}
              </Group>
            </div>
          </Group>
          {p.economia_note && (
            <Text fz="sm" mt="xs" className="testo-pre">
              {p.economia_note}
            </Text>
          )}
        </Alert>
      )}

      {vista.pagamenti.length === 0 ? (
        <Text fz="sm" c="dimmed">
          Nessun pagamento registrato.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={p.dac ? 820 : 640}>
          <Table verticalSpacing={6} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Data</Table.Th>
                <Table.Th ta="right">Importo</Table.Th>
                <Table.Th>Protocollo</Table.Th>
                <Table.Th>Fattura</Table.Th>
                {p.dac && <Table.Th>Titolo</Table.Th>}
                <Table.Th>Note</Table.Th>
                {modificabili && <Table.Th w={80} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {vista.pagamenti.map((pag) => (
                <Table.Tr key={pag.id}>
                  <Table.Td className="num">
                    {formattaData(pag.data)}
                    {pag.saldo && (
                      <Badge size="xs" color="teal" variant="light" ml={6}>
                        a saldo
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Importo valore={pag.importo} />
                  </Table.Td>
                  <Table.Td>
                    <Protocollo numero={pag.riferimento} data={pag.data} />
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm" c={pag.fattura ? undefined : 'dimmed'}>
                      {pag.fattura ?? '—'}
                    </Text>
                  </Table.Td>
                  {p.dac && (
                    <Table.Td>
                      <Text fz="sm" c={pag.codice_titolo || pag.codice_memoriale ? undefined : 'dimmed'}>
                        {[pag.codice_titolo, pag.codice_memoriale && `mem. ${pag.codice_memoriale}`, pag.data_titolo && formattaData(pag.data_titolo)].filter(Boolean).join(' · ') || '—'}
                      </Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text fz="sm" c={pag.note ? undefined : 'dimmed'}>
                      {pag.note ?? '—'}
                    </Text>
                  </Table.Td>
                  {modificabili && (
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        <ActionIcon variant="subtle" color="gray" onClick={() => setModale(pag)} aria-label="Modifica pagamento">
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" onClick={() => elimina(pag)} aria-label="Elimina pagamento">
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Td>
                  <Text fw={600} fz="sm">
                    Totale pagato
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Importo valore={vista.totalePagato} forte />
                </Table.Td>
                <Table.Td colSpan={colonne - 2} />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}

      {!p.saldato && vista.quotaPagata != null && (
        <Stack gap={4} mt="md" maw={520}>
          <Group justify="space-between">
            <Text fz="xs" c="dimmed">
              Pagato sul valore stipulato{vista.incentivi > 0 ? ' al netto degli incentivi' : ''}
            </Text>
            <Text fz="xs" className="num">
              {formattaPercentuale(vista.quotaPagata)}
              {residuo != null && residuo > 0 ? ` · residuo ${formattaEuro(residuo)}` : ''}
            </Text>
          </Group>
          <Meter rapporto={vista.quotaPagata} etichetta="Pagato sul valore stipulato" />
        </Stack>
      )}

      {modale && <ModalePagamento vista={vista} pagamento={modale} onClose={() => setModale(null)} />}
      {saldoAperto && <ModaleSaldo vista={vista} onClose={() => setSaldoAperto(false)} />}
      {economiaAperta && <ModaleEconomia vista={vista} onClose={() => setEconomiaAperta(false)} />}
    </Card>
  );
}
