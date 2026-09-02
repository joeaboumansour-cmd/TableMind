// A bug's identity. Deliberately coarse: the same defect found by three
// different charters must collapse to ONE record, because the entire point of
// deduping here is that a known bug never re-enters an agent's context.
import { createHash } from "node:crypto";

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    // numbers, ids and timestamps vary run to run and are not identity
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<uuid>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();

export function fingerprint({ class: cls, route, signature }) {
  return createHash("sha1")
    .update([norm(cls), norm(route), norm(signature)].join("|"))
    .digest("hex")
    .slice(0, 12);
}
