import fs from "fs";
import path from "path";
import crypto from "crypto";

// Simple JSON-file database. Fine for development and a single server.
// Replace with Postgres/SQLite before real use (concurrent writes are NOT safe).

export type Role = "user" | "teacher" | "admin";
export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
};
export type Card = {
  id: string;
  title: string;
  kind: "video" | "data" | "note" | "image";
  notes: string;
  text: string; // extracted text (only for text/CSV uploads)
  tags: string[];
  filename?: string;
  createdBy: string;
  createdAt: string;
};
export type EventType = "register" | "login" | "chat" | "teach_upload";
export type EventRec = { id: string; userId: string; type: EventType; at: string };
type Data = { users: User[]; cards: Card[]; events: EventRec[] };

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const FILE = path.join(DATA_DIR, "db.json");

function load(): Data {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) return { users: [], cards: [], events: [] };
  return JSON.parse(fs.readFileSync(FILE, "utf8")) as Data;
}
function save(d: Data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, FILE);
}
export const uid = () => crypto.randomUUID();

export function read(): Data {
  return load();
}
export function update(fn: (d: Data) => void) {
  const d = load();
  fn(d);
  save(d);
}
export function findUserByEmail(email: string) {
  return load().users.find((u) => u.email === email.toLowerCase());
}
export function findUserById(id: string) {
  return load().users.find((u) => u.id === id);
}
export function logEvent(userId: string, type: EventType) {
  update((d) => {
    d.events.push({ id: uid(), userId, type, at: new Date().toISOString() });
  });
}
