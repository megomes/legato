/** Portuguese wording for the engine's diagnostic messages (the engine itself reports in English). */
const RULES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/^Notes run past the end of the measure$/, "as notas passam do fim do compasso"],
  [/^A voice stops before the end of the measure$/, "uma voz para antes do fim do compasso"],
  [/^Notes of one voice overlap$/, "notas da mesma voz se sobrepõem"],
  [/^Staff (upper|lower) does not fill the measure$/, (m) => `a pauta ${m[1] === "upper" ? "superior" : "inferior"} não completa o compasso`],
  [/^Measure adds up to (\S+) instead of (\S+) quarter notes$/, (m) => `o compasso soma ${m[1]} semínimas em vez de ${m[2]}`],
  [/^Rhythm is ambiguous \(several readings fit\)$/, "o ritmo é ambíguo (mais de uma leitura fecha)"],
  [/^Rhythm could not be resolved$/, "o ritmo não pôde ser resolvido"],
  [/^Notehead without a stem$/, "cabeça de nota sem haste"],
  [/^Notehead not aligned to a staff position/, "cabeça de nota fora das linhas e espaços da pauta"],
  [/^Accidental \((\w+)\) not attached to any note$/, "acidente solto, sem nota correspondente"],
  [/^Key signature does not follow the standard order$/, "armadura de clave fora da ordem padrão"],
  [/^No clef at the start of the system$/, "sistema sem clave no início"],
  [/^Clef on an unexpected line/, "clave numa linha inesperada"],
  [/^Unreadable time signature/, "fórmula de compasso ilegível"],
  [/^Time signature differs between staves$/, "fórmula de compasso diferente entre as pautas"],
  [/^Number outside the staff \(multi-measure rest\?\)$/, "número fora da pauta (pausa de vários compassos?)"],
  [/^Tuplet number (\d) could not be matched to its notes$/, (m) => `quiáltera de ${m[1]} sem notas correspondentes`],
  [/^Tuplet (\d) group does not add up/, (m) => `grupo de quiáltera de ${m[1]} não fecha`],
  [/^Nested tuplets are not supported$/, "quiálteras dentro de quiálteras não são suportadas"],
  [/^Flag not attached to any stem$/, "colchete sem haste"],
  [/^Chord mixes notehead types$/, "acorde com tipos de cabeça diferentes"],
  [/^Half note with beams \(tremolo\) is not supported$/, "trêmolo em mínima não é suportado"],
  [/^Empty measure \(no notes or rests\)$/, "compasso vazio (sem notas nem pausas)"],
  [/^No time signature before this measure$/, "nenhuma fórmula de compasso antes deste compasso"],
];

export function pt(message: string): string {
  for (const [re, out] of RULES) {
    const m = message.match(re);
    if (m) return typeof out === "string" ? out : out(m);
  }
  return message;
}
