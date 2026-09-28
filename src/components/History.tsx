"use client";

import type { HistoryItem } from "@/lib/protocol";
import { clientId } from "@/lib/client";
import { Icon } from "./Icon";
import styles from "./History.module.css";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function History({ items }: { items: HistoryItem[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.root} aria-labelledby="history-title">
      <h2 id="history-title" className={styles.title}>
        <Icon name="history" size={17} /> Conversões recentes
      </h2>
      <ul className={styles.list}>
        {items.map((it) => (
          <li key={it.id} className={styles.item}>
            <span className={`${styles.dot} ${it.ok ? styles.ok : styles.bad}`} aria-label={it.ok ? "Convertida" : "Recusada"} />
            <div className={styles.main}>
              <p className={styles.name}>{it.title || it.fileName.replace(/\.pdf$/i, "")}</p>
              <p className={styles.meta}>
                {fmtDate(it.createdAt)}
                {it.ok ? (
                  <>
                    {" · "}
                    {it.measures} compassos · {it.durationSeconds ? fmtTime(it.durationSeconds) : "—"}
                  </>
                ) : (
                  <> · {it.errorMessage ?? "Recusada"}</>
                )}
              </p>
            </div>
            {it.ok && (
              <a className={styles.dl} href={`/api/midi/${it.id}?client=${encodeURIComponent(clientId())}`} download>
                <Icon name="download" size={16} /> MIDI
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
