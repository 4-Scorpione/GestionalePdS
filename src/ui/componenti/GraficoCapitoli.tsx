import { Box, Group, Stack, Text, Tooltip, useComputedColorScheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle } from '@tabler/icons-react';
import { etichettaCapitolo as nomeCapitolo } from '../../domain/calcoli';
import { formattaEuro, formattaEuroCompatto, formattaPercentuale, rapporto } from '../../domain/importi';
import { sforamentoDaSegnalare, type RigaSintesi } from '../../domain/sintesi';
import { COLORI_GRAFICO } from '../tema';

type Serie = 'inviato' | 'stipulato' | 'pagato';

const SERIE: { chiave: Serie; etichetta: string }[] = [
  { chiave: 'inviato', etichetta: 'Impegnato (Trasmesso)' },
  { chiave: 'stipulato', etichetta: 'Impegnato (Stipulato)' },
  { chiave: 'pagato', etichetta: 'Effettivo pagato' },
];

const SPESSORE = 8;
const INTERVALLO = 2;
/** Oltre questa quota del finanziato le barre si fermano e riportano la percentuale. */
const QUOTA_MASSIMA = 1.5;

/**
 * Avanzamento dei capitoli: ogni capitolo è in scala sul proprio finanziato
 * (100%), così le barre restano leggibili e confrontabili anche quando i
 * finanziamenti differiscono di ordini di grandezza. Gli importi sono nel
 * testo, nei tooltip e nella tabella sottostante.
 */
export function GraficoCapitoli({ righe }: { righe: RigaSintesi[] }) {
  const schema = useComputedColorScheme('light');
  const colori = COLORI_GRAFICO[schema === 'dark' ? 'scuro' : 'chiaro'];
  const stretto = useMediaQuery('(max-width: 48em)');

  const quote = righe.flatMap((r) => SERIE.map((s) => rapporto(r[s.chiave], r.finanziato) ?? 0));
  const massima = Math.max(1, ...quote);
  // fondo scala: 100%, oppure la quota più alta arrotondata ai 10 punti, al massimo 150%
  const fondo = massima <= 1 ? 1 : Math.min(QUOTA_MASSIMA, Math.ceil(massima * 10) / 10);
  const tacche = [...(stretto ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]), ...(fondo > 1 ? [fondo] : [])];
  const posizione = (quota: number) => `${(Math.min(quota, fondo) / fondo) * 100}%`;
  const traccia = `color-mix(in srgb, ${colori.finanziato} 28%, transparent)`;

  const legenda = (
    <Group gap="md" wrap="wrap" component="ul" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Legenda">
      {SERIE.map((s) => (
        <Group key={s.chiave} gap={6} component="li" wrap="nowrap">
          <span aria-hidden style={{ width: 14, height: 8, borderRadius: 2, background: colori[s.chiave], display: 'inline-block' }} />
          <Text fz="xs" c="var(--pds-inchiostro-2)">
            {s.etichetta}
          </Text>
        </Group>
      ))}
      <Group gap={6} component="li" wrap="nowrap">
        <span aria-hidden style={{ width: 14, height: 12, borderRadius: 2, background: traccia, borderRight: '1px solid var(--pds-inchiostro-2)', display: 'inline-block' }} />
        <Text fz="xs" c="var(--pds-inchiostro-2)">
          Finanziato del capitolo (100%)
        </Text>
      </Group>
    </Group>
  );

  const griglia = tacche.map((t) => (
    <div key={t} aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: posizione(t), width: 1, background: t === 1 ? 'var(--pds-inchiostro-2)' : 'var(--pds-griglia)' }} />
  ));

  const asse = (
    <div style={{ position: 'relative', height: 18 }} aria-hidden>
      {tacche.map((t, i) => (
        <Text
          key={t}
          fz={11}
          c="var(--pds-muto)"
          className="num"
          style={{ position: 'absolute', left: posizione(t), transform: i === 0 ? 'none' : i === tacche.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)', top: 2 }}
        >
          {formattaPercentuale(t, '—', 0)}
        </Text>
      ))}
    </div>
  );

  return (
    <Stack gap="sm">
      {legenda}
      <div style={{ display: 'grid', gridTemplateColumns: stretto ? '1fr' : 'minmax(150px, 230px) 1fr', columnGap: 16 }}>
        {!stretto && <div />}
        {asse}
        {righe.map((r, indiceRiga) => {
          const nome = nomeCapitolo(r.capitolo, false);
          return (
            <div key={r.capitolo.id} style={{ display: 'contents' }}>
              <Box py={8} pr={4} style={{ borderTop: '1px solid var(--pds-griglia)' }}>
                <Group gap={6} wrap="nowrap" align="flex-start">
                  <Text fz="sm" fw={600} lh={1.3}>
                    {nome}
                  </Text>
                  {sforamentoDaSegnalare(r) && (
                    <Group gap={3} wrap="nowrap">
                      <IconAlertTriangle size={15} color="var(--pds-critico)" aria-hidden />
                      <Text fz={11} fw={600} c="red.7">
                        Superamento
                      </Text>
                    </Group>
                  )}
                </Group>
                <Text fz="xs" c="dimmed" className="num">
                  Finanziato {formattaEuroCompatto(r.finanziato)}
                </Text>
              </Box>
              {r.finanziato <= 0 ? (
                <Text fz="xs" c="dimmed" py={10} style={{ borderTop: stretto ? undefined : '1px solid var(--pds-griglia)', alignSelf: 'center' }}>
                  Nessun finanziato: le quote non sono calcolabili (importi nella tabella).
                </Text>
              ) : (
                <div style={{ position: 'relative', paddingBlock: stretto ? '0 12px' : 10, borderTop: stretto ? undefined : '1px solid var(--pds-griglia)' }}>
                  {/* traccia del finanziato: da 0 al 100% del capitolo */}
                  <div aria-hidden style={{ position: 'absolute', top: stretto ? 0 : 6, bottom: stretto ? 8 : 6, left: 0, width: posizione(1), background: traccia, borderRadius: '0 3px 3px 0' }} />
                  {griglia}
                  {SERIE.map((s) => {
                    const valore = r[s.chiave];
                    const quota = rapporto(valore, r.finanziato) ?? 0;
                    const oltreFondo = quota > fondo;
                    const testo = `${nome} · ${s.etichetta}: ${formattaEuro(valore)} (${formattaPercentuale(quota)} del finanziato di ${formattaEuro(r.finanziato)})${s.chiave !== 'pagato' && quota > 1 ? ' – supera il finanziato' : ''}`;
                    return (
                      <Tooltip key={s.chiave} label={testo} position="top-start" offset={2} openDelay={60}>
                        <div
                          tabIndex={0}
                          role="img"
                          aria-label={testo}
                          style={{ height: SPESSORE + INTERVALLO * 2, display: 'flex', alignItems: 'center', position: 'relative', outlineOffset: 1 }}
                        >
                          <div style={{ width: posizione(quota), minWidth: valore > 0 ? 3 : 0, height: SPESSORE, background: colori[s.chiave], borderRadius: '0 4px 4px 0' }} />
                          {(oltreFondo || (indiceRiga === 0 && !stretto && quota / fondo < 0.7)) && (
                            <Text
                              fz={10.5}
                              c="var(--pds-inchiostro-2)"
                              ml={oltreFondo ? undefined : 4}
                              px={3}
                              className="num"
                              style={{
                                whiteSpace: 'nowrap',
                                lineHeight: '13px',
                                background: 'var(--mantine-color-body)',
                                borderRadius: 3,
                                zIndex: 1,
                                ...(oltreFondo ? { position: 'absolute', right: 0 } : { position: 'relative' }),
                              }}
                              aria-hidden
                            >
                              {oltreFondo ? `▸ ${formattaPercentuale(quota)}` : s.etichetta}
                            </Text>
                          )}
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Text fz="xs" c="dimmed">
        Ogni capitolo è in scala sul proprio finanziato (100%), così le barre si leggono anche tra capitoli di importo molto diverso. Passare sulle barre (o
        selezionarle con il tasto Tab) per gli importi; tutti i valori sono nella tabella sottostante.
      </Text>
    </Stack>
  );
}
