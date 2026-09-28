"use client";

import { useState } from "react";
import type { ClientResult } from "@/lib/protocol";
import { pt } from "@/lib/messages";
import { Icon, type IconName } from "./Icon";
import styles from "./ErrorCard.module.css";

const COPY: Record<string, { title: string; body: string; icon: IconName }> = {
  "not-pdf": { title: "Esse arquivo não é um PDF válido.", body: "Exporte a partitura como PDF no programa de notação e tente de novo.", icon: "file" },
  scanned: {
    title: "Este PDF parece ser uma digitalização.",
    body: "Partituras escaneadas ou fotografadas são imagens, sem as informações que o Legato lê. Use o PDF exportado pelo programa de notação.",
    icon: "scan",
  },
  "no-music": { title: "Não encontrei notação musical neste PDF.", body: "O arquivo não tem pautas nem símbolos musicais vetoriais.", icon: "music" },
  "unsupported-font": {
    title: "A fonte musical deste PDF ainda não é suportada.",
    body: "O Legato reconhece as fontes do Sibelius, MuseScore, Finale, Dorico e Musicnotes. Esta usa outra família de símbolos.",
    icon: "layers",
  },
  "not-piano": { title: "Não encontrei um sistema de piano.", body: "O Legato lê partituras de piano: duas pautas unidas por chave em cada sistema.", icon: "key" },
  unreliable: {
    title: "Esta partitura não pôde ser convertida com segurança.",
    body: "Parte da notação não fecha de forma única. O Legato prefere recusar a gerar um MIDI com notas ou ritmos errados.",
    icon: "shield",
  },
  navigation: {
    title: "Não consegui resolver as repetições e saltos com segurança.",
    body: "Há D.S., D.C., Coda ou casas de repetição que não formam um caminho único.",
    icon: "refresh",
  },
  ottava: {
    title: "Esta partitura usa linhas de oitava (8va / 8vb).",
    body: "As notas sob essas linhas soam uma oitava acima ou abaixo do que está escrito. O Legato ainda não lê essas linhas, então recusa em vez de tocar as notas na oitava errada.",
    icon: "music",
  },
  internal: { title: "Algo deu errado ao ler este PDF.", body: "O conversor encontrou um erro interno. Os detalhes abaixo ajudam a investigar.", icon: "alert" },
};

export function ErrorCard({ result, message, onReset }: { result?: ClientResult; message?: string; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const err = result?.error;
  const copy = COPY[err?.code ?? "internal"] ?? COPY.internal;
  const first = err?.measures?.[0];
  const c = result?.confidence;

  return (
    <section className={styles.card} role="alert">
      <div className={styles.icon}>
        <Icon name={copy.icon} size={28} />
      </div>
      <div className={styles.body}>
        {result?.title && <p className={styles.file}>{result.title}</p>}
        <h2 className={styles.title}>{message && !err ? message : copy.title}</h2>
        <p className={styles.text}>{copy.body}</p>
        {first && (
          <p className={styles.where}>
            <span>Compasso {first.measure}</span> na página {first.page}: {pt(first.problems[0])}
            {err!.measures!.length > 1 && <> · e mais {err!.measures!.length - 1} compasso(s)</>}
          </p>
        )}
        {c && c.checkedMeasures > 0 && (
          <div className={styles.meter} aria-label="Compassos validados">
            <div className={styles.meterBar}>
              <i style={{ width: `${(1 - c.failedMeasures / c.checkedMeasures) * 100}%` }} />
            </div>
            <span className="tabular">
              {c.checkedMeasures - c.failedMeasures} de {c.checkedMeasures} compassos passaram na validação
            </span>
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.retry} onClick={onReset}>
            <Icon name="upload" size={17} /> Tentar outro PDF
          </button>
          {err && (
            <button type="button" className={styles.more} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              Detalhes <Icon name="chevron" size={15} className={open ? styles.flip : ""} />
            </button>
          )}
        </div>
        {open && err && (
          <div className={styles.details}>
            <p className={styles.tech}>{err.message}</p>
            <ul>
              {err.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            {err.measures && err.measures.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Compasso</th>
                    <th>Página</th>
                    <th>Problema</th>
                  </tr>
                </thead>
                <tbody>
                  {err.measures.slice(0, 60).map((m) => (
                    <tr key={m.measure}>
                      <td className="tabular">{m.measure}</td>
                      <td className="tabular">{m.page}</td>
                      <td>{m.problems.map(pt).join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.engine}>Motor {result?.engine}</p>
          </div>
        )}
      </div>
    </section>
  );
}
