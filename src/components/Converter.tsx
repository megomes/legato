"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientResult, HistoryItem } from "@/lib/protocol";
import { MAX_UPLOAD_BYTES } from "@/lib/protocol";
import { convertOnServer, loadHistory } from "@/lib/client";
import { DropZone } from "./DropZone";
import { ErrorCard } from "./ErrorCard";
import { History } from "./History";
import { Icon } from "./Icon";
import { Progress } from "./Progress";
import { Result } from "./Result";
import styles from "./Converter.module.css";

type State =
  | { kind: "idle" }
  | { kind: "working"; file: File; stage: number }
  | { kind: "done"; result: ClientResult }
  | { kind: "failed"; result?: ClientResult; message?: string };

export function Converter() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const refresh = useCallback(() => {
    void loadHistory().then((h) => setHistory(h.items));
  }, []);
  useEffect(refresh, [refresh]);

  const run = useCallback(
    async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        setState({ kind: "failed", message: "Este PDF passa de 4 MB. Partituras de piano exportadas costumam ter menos de 1 MB." });
        return;
      }
      setState({ kind: "working", file, stage: 0 });
      const started = performance.now();
      try {
        const result = await convertOnServer(file, (_stage, index) => setState((s) => (s.kind === "working" ? { ...s, stage: index } : s)));
        // let the last stage register visually before swapping screens
        const elapsed = performance.now() - started;
        if (elapsed < 900) await new Promise((r) => setTimeout(r, 900 - elapsed));
        setState(result.ok ? { kind: "done", result } : { kind: "failed", result });
      } catch (e) {
        setState({ kind: "failed", message: e instanceof Error ? e.message : "Falha na conversão." });
      }
      refresh();
    },
    [refresh],
  );

  const sample = useCallback(async () => {
    const res = await fetch("/exemplo.pdf");
    const blob = await res.blob();
    void run(new File([blob], "Estudo em Lá menor (exemplo).pdf", { type: "application/pdf" }));
  }, [run]);

  const reset = () => setState({ kind: "idle" });

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <button type="button" className={styles.brand} onClick={reset} aria-label="Legato, voltar ao início">
          Legato<span>.</span>
        </button>
        <p className={styles.tag}>
          <span className={styles.pdf}>PDF</span>
          <Icon name="chevron" size={14} className={styles.arrow} />
          <span className={styles.midi}>MIDI</span> para Synthesia
        </p>
      </header>

      <main className={styles.main}>
        {state.kind === "idle" && (
          <>
            <section className={styles.hero}>
              <h1>
                Da partitura ao <em>Synthesia</em>, nota por nota.
              </h1>
              <p>
                Solte o PDF de uma partitura de piano. O Legato lê a notação vetorial do arquivo, confere cada compasso e entrega um MIDI com{" "}
                <b className={styles.rhText}>mão direita</b> e <b className={styles.lhText}>mão esquerda</b> separadas. Se alguma coisa não fechar, ele
                recusa e diz onde.
              </p>
            </section>
            <DropZone onFile={run} onSample={sample} />
            <section className={styles.pillars} aria-label="Como funciona">
              <div>
                <Icon name="eye" size={20} />
                <h2>Lê o vetor, não a imagem</h2>
                <p>Cada cabeça de nota do PDF é um caractere com posição exata. Nada de reconhecimento óptico.</p>
              </div>
              <div>
                <Icon name="shield" size={20} />
                <h2>Recusa em vez de adivinhar</h2>
                <p>Todo compasso precisa fechar de um único jeito. Um compasso duvidoso bloqueia o MIDI inteiro.</p>
              </div>
              <div>
                <Icon name="hands" size={20} />
                <h2>Mãos e repetições resolvidas</h2>
                <p>Indicações de mão, ritornelos, D.S. e Coda viram uma linha do tempo que o Synthesia entende.</p>
              </div>
            </section>
            <History items={history} />
          </>
        )}
        {state.kind === "working" && <Progress fileName={state.file.name} size={state.file.size} stage={state.stage} />}
        {state.kind === "done" && <Result result={state.result} onReset={reset} />}
        {state.kind === "failed" && <ErrorCard result={state.result} message={state.message} onReset={reset} />}
      </main>

      <footer className={styles.foot}>
        <span>Legato · motor vetorial próprio · os PDFs não são guardados</span>
        <span className={styles.legend}>
          <i className={styles.rhSwatch} /> mão direita <i className={styles.lhSwatch} /> mão esquerda
        </span>
      </footer>
    </div>
  );
}
