import type { SupabaseClient } from "@supabase/supabase-js";

export type Role = "user" | "teacher" | "admin";
export type User = { id: string; email: string; name: string; role: Role; created_at: string };
export type Card = {
  id: string; title: string; kind: "video" | "data" | "note" | "image";
  notes: string; content_text: string; tags: string[]; file_path: string | null;
  created_by: string; created_at: string;
};
export type EventType = "register" | "login" | "chat" | "teach_upload";

export async function logEvent(sb: SupabaseClient, userId: string, type: EventType) {
  await sb.from("events").insert({ user_id: userId, type });
}
