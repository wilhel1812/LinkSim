import { describe, expect, it } from "vitest";
import { chooseIdentityReconcileCandidate } from "./db";

type Candidate = Parameters<typeof chooseIdentityReconcileCandidate>[0][number];

const makeCandidate = (patch: Partial<Candidate>): Candidate => ({
  id: patch.id ?? "u",
  username: patch.username ?? null,
  email: patch.email ?? null,
  bio: patch.bio ?? null,
  access_request_note: patch.access_request_note ?? null,
  idp_email: patch.idp_email ?? null,
  idp_email_verified: patch.idp_email_verified ?? 0,
  avatar_url: patch.avatar_url ?? null,
  email_public: patch.email_public ?? 1,
  avatar_object_key: patch.avatar_object_key ?? null,
  avatar_thumb_key: patch.avatar_thumb_key ?? null,
  avatar_hash: patch.avatar_hash ?? null,
  avatar_bytes: patch.avatar_bytes ?? null,
  avatar_content_type: patch.avatar_content_type ?? null,
  is_admin: patch.is_admin ?? 0,
  is_moderator: patch.is_moderator ?? 0,
  is_approved: patch.is_approved ?? 0,
  approved_at: patch.approved_at ?? null,
  approved_by_user_id: patch.approved_by_user_id ?? null,
  created_at: patch.created_at ?? "2026-01-01T00:00:00.000Z",
  updated_at: patch.updated_at ?? null,
  match_kind: patch.match_kind ?? "legacy_email",
});

describe("chooseIdentityReconcileCandidate", () => {
  it("prefers verified idp-email matches over legacy email matches", () => {
    const selected = chooseIdentityReconcileCandidate([
      makeCandidate({ id: "legacy", match_kind: "legacy_email", is_admin: 1, is_approved: 1 }),
      makeCandidate({ id: "verified", match_kind: "verified_idp_email", is_admin: 0, is_approved: 0 }),
    ]);
    expect(selected?.id).toBe("verified");
  });

  it("within same match kind prefers admin then approved then oldest", () => {
    const selected = chooseIdentityReconcileCandidate([
      makeCandidate({ id: "newer", match_kind: "verified_idp_email", is_admin: 0, is_approved: 1, created_at: "2026-01-03T00:00:00.000Z" }),
      makeCandidate({ id: "older", match_kind: "verified_idp_email", is_admin: 0, is_approved: 1, created_at: "2026-01-02T00:00:00.000Z" }),
      makeCandidate({ id: "admin", match_kind: "verified_idp_email", is_admin: 1, is_approved: 0, created_at: "2026-01-10T00:00:00.000Z" }),
    ]);
    expect(selected?.id).toBe("admin");
  });

  it("returns null for empty candidate list", () => {
    expect(chooseIdentityReconcileCandidate([])).toBeNull();
  });
});
