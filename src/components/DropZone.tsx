"use client";

import { useRef, useState } from "react";
import { Icon } from "./Icon";
import styles from "./DropZone.module.css";

export function DropZone({ onFile, onSample }: { onFile: (f: File) => void; onSample: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const accept = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setHint("Esse arquivo não é um PDF. Exporte a partitura como PDF e tente de novo.");
      return;
    }
    setHint(null);
    onFile(f);
  };

  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.zone} ${over ? styles.over : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          accept(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        aria-label="Solte um PDF de partitura de piano ou clique para escolher"
      >
        <svg className={styles.staff} viewBox="0 0 800 120" preserveAspectRatio="none" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1="0" x2="800" y1={20 + i * 20} y2={20 + i * 20} />
          ))}
        </svg>
        <div className={styles.notes} aria-hidden="true">
          {[18, 30, 44, 57, 70, 82].map((left, i) => (
            <span key={i} style={{ left: `${left}%`, top: `${[58, 40, 50, 30, 46, 36][i]}%`, animationDelay: `${i * 0.18}s` }} className={i % 2 ? styles.lh : styles.rh} />
          ))}
        </div>
        <div className={styles.center}>
          <div className={styles.badge}>
            <Icon name="upload" size={26} />
          </div>
          <p className={styles.title}>Solte a partitura em PDF aqui</p>
          <p className={styles.sub}>
            ou <span className={styles.link}>escolha um arquivo</span> do seu computador
          </p>
        </div>
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => accept(e.target.files)} />
      </div>
      <div className={styles.foot}>
        <span>
          <Icon name="info" size={15} /> PDFs exportados do MuseScore, Sibelius, Finale, Dorico ou Musicnotes. Partituras escaneadas não são aceitas.
        </span>
        <button type="button" className={styles.sample} onClick={onSample}>
          <Icon name="wand" size={15} /> Testar com um exemplo
        </button>
      </div>
      {hint && (
        <p className={styles.hint} role="alert">
          <Icon name="alert" size={15} /> {hint}
        </p>
      )}
    </div>
  );
}
