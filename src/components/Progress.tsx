"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./Progress.module.css";

export const STAGE_LABELS: { label: string; detail: string; icon: IconName }[] = [
  { label: "Lendo a partitura", detail: "Glifos, pautas e traços vetoriais do PDF", icon: "eye" },
  { label: "Reconstruindo a notação", detail: "Notas, ritmos, claves, armaduras e ligaduras", icon: "layers" },
  { label: "Validando compassos", detail: "Cada compasso precisa fechar exatamente", icon: "shield" },
  { label: "Separando as mãos", detail: "Pautas, vozes e indicações de mão", icon: "hands" },
  { label: "Gerando o MIDI", detail: "Linha do tempo, andamento e faixas", icon: "wave" },
];

const WHITE_KEYS = 36;

export function Progress({ fileName, size, stage }: { fileName: string; size: number; stage: number }) {
  // ease the key fill towards the current stage so quick stages still read as motion
  const target = Math.min(1, (stage + 0.6) / STAGE_LABELS.length);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setShown((v) => {
        const nv = v + (target - v) * 0.12;
        if (Math.abs(nv - target) > 0.002) raf = requestAnimationFrame(tick);
        return nv;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  const lit = Math.round(shown * WHITE_KEYS);

  return (
    <section className={styles.card} aria-live="polite">
      <header className={styles.head}>
        <div className={styles.file}>
          <Icon name="file" size={22} />
          <div>
            <p className={styles.name}>{fileName}</p>
            <p className={styles.size}>{(size / 1024).toFixed(0)} KB</p>
          </div>
        </div>
        <p className={styles.pct}>{Math.round(shown * 100)}%</p>
      </header>

      <div className={styles.keys} aria-hidden="true">
        {Array.from({ length: WHITE_KEYS }, (_, i) => (
          <span key={i} className={`${styles.white} ${i < lit ? (i % 7 < 4 ? styles.onR : styles.onL) : ""}`} />
        ))}
        {Array.from({ length: WHITE_KEYS }, (_, i) =>
          [0, 1, 3, 4, 5].includes(i % 7) && i < WHITE_KEYS - 1 ? (
            <span key={`b${i}`} className={styles.black} style={{ left: `calc(${((i + 1) / WHITE_KEYS) * 100}% - 1.1%)` }} />
          ) : null,
        )}
      </div>

      <ol className={styles.stages}>
        {STAGE_LABELS.map((s, i) => {
          const state = i < stage ? "done" : i === stage ? "active" : "todo";
          return (
            <li key={s.label} className={styles[state]}>
              <span className={styles.dot}>{state === "done" ? <Icon name="check" size={15} stroke={2.4} /> : <Icon name={s.icon} size={15} />}</span>
              <span className={styles.text}>
                <span className={styles.label}>{s.label}</span>
                <span className={styles.detail}>{s.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
