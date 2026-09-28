import fs from "node:fs";
import { generateCase } from "./generate";
const c = generateCase(Number(process.argv[2] ?? 1), `Case ${process.argv[2] ?? 1}`);
fs.writeFileSync(process.argv[3], c.xml);
console.log(c.features.join(", "), c.notes.length, "notes");
