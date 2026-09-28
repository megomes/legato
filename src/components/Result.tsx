"use client";

import { useState } from "react";
import type { ClientResult } from "@/lib/protocol";
import { downloadBytes, midiFileName } from "@/lib/client";
import { Icon } from "./Icon";
import { usePlayer } from "./usePlayer";
import { Waterfall } from "./Waterfall";
import styles from "./Result.module.css";

const NOTE_NAMES = ["Dó", "Dó♯", "Ré", "Mi♭", "Mi", "Fá", "Fá♯", "Sol", "Lá♭", "Lá", "Si♭", "Si"];
const MAJOR = ["Dó♭", "Sol♭", "Ré♭", "Lá♭", "Mi♭", "Si♭", "Fá", "Dó", "Sol", "Ré", "Lá", "Mi", "Si", "Fá♯", "Dó♯"];
const MINOR = ["Lá♭", "Mi♭", "Si♭", "Fá", "Dó", "Sol", "Ré", "Lá", "Mi", "Si", "Fá♯", "Dó♯", "Sol♯", "Ré♯", "Lá♯"];
/** A key signature fits a major key and its relative minor; show both rather than guess. */
const keyName = (fifths: number) => `${MAJOR[fifths + 7]} maior · ${MINOR[fifths + 7]} menor`;

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const noteName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function Result({ result, onReset }: { result: ClientResult; onReset: () => void }) {
  const s = result.stats!;
  const c = result.confidence!;
  const p = result.preview!;
  const player = usePlayer(p.notes, p.duration);
  const [open, setOpen] = useState(false);
  const handsLabel = c.hands >= 0.999 ? "Alta" : c.hands >= 0.95 ? pct(c.hands) : `${pct(c.hands)} · revisar`;
  const rhShare = s.rightHandNotes / Math.max(1, s.notes);

  return (
    <section className={styles.root}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <p className={styles.eyebrow}>
            <span className={styles.okDot} /> MIDI pronto para o Synthesia
          </p>
          <h1 className={styles.title}>{result.title || result.fileName.replace(/\.pdf$/i, "")}</h1>
          {result.composer && <p className={styles.composer}>{result.composer}</p>}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => downloadBytes(result.midiBase64!, midiFileName(result))}>
            <Icon name="download" size={19} stroke={2.2} /> Baixar MIDI
          </button>
          <button type="button" className={styles.secondary} onClick={onReset}>
            <Icon name="refresh" size={17} /> Converter outra
          </button>
        </div>
      </header>

      <div className={styles.badges}>
        <span className={styles.badgeOk}>
          <Icon name="shield" size={15} /> {fmtInt(c.checkedMeasures)} de {fmtInt(c.checkedMeasures)} compassos validados
        </span>
        <span className={c.hands >= 0.95 ? styles.badgeOk : styles.badgeWarn}>
          <Icon name="hands" size={15} /> Separação das mãos: {handsLabel}
        </span>
        {result.navigation.length > 0 && (
          <span className={styles.badge}>
            <Icon name="refresh" size={15} /> Repetições desenroladas
          </span>
        )}
      </div>

      <dl className={styles.stats}>
        <div>
          <dt>
            <Icon name="clock" size={15} /> Duração
          </dt>
          <dd className="tabular">{fmtTime(s.durationSeconds)}</dd>
        </div>
        <div>
          <dt>
            <Icon name="bars" size={15} /> Compassos
          </dt>
          <dd className="tabular">
            {fmtInt(s.measures)}
            {s.performedMeasures !== s.measures && <small> · {fmtInt(s.performedMeasures)} tocados</small>}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="music" size={15} /> Notas
          </dt>
          <dd className="tabular">{fmtInt(s.notes)}</dd>
        </div>
        <div>
          <dt>
            <Icon name="speed" size={15} /> Andamento
          </dt>
          <dd className="tabular">
            {s.tempo || `♩ = ${s.tempoBpm}`}
            {s.tempoEstimated && <small> · ≈{s.tempoBpm}</small>}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="key" size={15} /> Tonalidade
          </dt>
          <dd>
            <span className={styles.keyName}>{keyName(s.keyFifths)}</span> <small>{s.timeSignature}</small>
          </dd>
        </div>
      </dl>

      <div className={styles.split} aria-label="Distribuição das notas entre as mãos">
        <span className={styles.splitLabel}>
          <i className={styles.rh} /> Mão direita <b className="tabular">{fmtInt(s.rightHandNotes)}</b>
        </span>
        <div className={styles.splitBar}>
          <i style={{ width: `${rhShare * 100}%` }} className={styles.rhBar} />
          <i style={{ width: `${(1 - rhShare) * 100}%` }} className={styles.lhBar} />
        </div>
        <span className={styles.splitLabel}>
          <b className="tabular">{fmtInt(s.leftHandNotes)}</b> Mão esquerda <i className={styles.lh} />
        </span>
      </div>

      <div className={styles.player}>
        <Waterfall
          notes={p.notes}
          duration={p.duration}
          measureStarts={p.measureStarts}
          measureNumbers={p.measureNumbers}
          getTime={player.getTime}
          playing={player.playing}
          muted={player.muted}
          onSeek={player.seek}
        />
        <div className={styles.transport}>
          <button type="button" className={styles.play} onClick={player.toggle} aria-label={player.playing ? "Pausar" : "Tocar"} disabled={player.loading}>
            {player.loading ? <span className={styles.spinner} /> : <Icon name={player.playing ? "pause" : "play"} size={22} stroke={2.6} />}
          </button>
          <span className={`${styles.clock} tabular`}>
            {fmtTime(player.time)} <span>/ {fmtTime(p.duration)}</span>
          </span>
          {player.loading && <span className={styles.loading}>Carregando o piano…</span>}
          <div className={styles.grow} />
          <div className={styles.hands} role="group" aria-label="Mãos audíveis">
            <button type="button" aria-pressed={!player.muted.R} className={`${styles.hand} ${styles.handR}`} onClick={() => player.toggleHand("R")}>
              Direita
            </button>
            <button type="button" aria-pressed={!player.muted.L} className={`${styles.hand} ${styles.handL}`} onClick={() => player.toggleHand("L")}>
              Esquerda
            </button>
          </div>
          <div className={styles.speed} role="group" aria-label="Velocidade">
            {[0.5, 0.75, 1].map((v) => (
              <button key={v} type="button" aria-pressed={player.speed === v} onClick={() => player.setSpeed(v)}>
                {v === 1 ? "1×" : `${v.toLocaleString("pt-BR")}×`}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.tip}>Espaço toca e pausa. Arraste a cachoeira ou clique no mapa para navegar.</p>
      </div>

      <div className={styles.details}>
        <button type="button" className={styles.detailsToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="info" size={16} /> Detalhes técnicos
          <Icon name="chevron" size={16} className={open ? styles.flip : ""} />
        </button>
        {open && (
          <div className={styles.detailsBody}>
            <dl className={styles.kv}>
              <dt>Motor</dt>
              <dd>{result.engine}</dd>
              <dt>Fonte musical</dt>
              <dd>{s.font}</dd>
              <dt>Gerado por</dt>
              <dd>{s.producer || "—"}</dd>
              <dt>Páginas com música</dt>
              <dd className="tabular">
                {s.musicPages} de {s.pages}
              </dd>
              <dt>Sistemas</dt>
              <dd className="tabular">{s.systems}</dd>
              <dt>Ligaduras de prolongamento</dt>
              <dd className="tabular">{fmtInt(s.ties)}</dd>
              <dt>Apojaturas</dt>
              <dd className="tabular">{fmtInt(s.graceNotes)}</dd>
              <dt>Extensão</dt>
              <dd>
                {noteName(s.lowestNote)} – {noteName(s.highestNote)}
              </dd>
              <dt>Faixas MIDI</dt>
              <dd>Right Hand (canal 1) · Left Hand (canal 2) · PPQ 960</dd>
              <dt>Tempo por etapa</dt>
              <dd className="tabular">
                {Object.values(result.timingsMs).reduce((a, b) => a + b, 0)} ms (
                {Object.entries(result.timingsMs)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}
                )
              </dd>
            </dl>
            {result.navigation.length > 0 && (
              <div>
                <h3>Navegação</h3>
                <ul>
                  {result.navigation.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.handNotes.length > 0 && (
              <div>
                <h3>Mãos</h3>
                <ul>
                  {result.handNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.warnings.length > 0 && (
              <div>
                <h3>Avisos</h3>
                <ul>
                  {result.warnings.slice(0, 30).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
