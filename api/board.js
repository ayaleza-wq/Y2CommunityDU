// One endpoint for the whole board.
//   GET  /api/board?code=ABCDE              -> public board state (no secrets)
//   POST /api/board { action, code, ... }   -> create | join | persona | addProblem |
//                                              editProblem | removeProblem | mark | phase
// Members prove who they are with { memberId, memberToken }; the host with { hostToken }.
import * as store from "../lib/store.js";

const send = (res, status, body) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
};

export default async function handler(req, res) {
  if (!store.hasDatabase)
    return send(res, 503, { error: "The board isn't connected to its database yet. In Vercel: Storage → connect Upstash Redis to this project, then redeploy." });
  try {
    if (req.method === "GET") {
      const code = store.normCode(req.query.code);
      const board = code && (await store.readBoard(code));
      return board ? send(res, 200, board) : send(res, 404, { error: "No group with that code. It may have expired." });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.action === "create") {
      const meta = await store.createGroup();
      return send(res, 200, { code: meta.code, hostToken: meta.hostToken });
    }

    const code = store.normCode(b.code);
    const meta = await store.getMeta(code);
    if (!meta) return send(res, 404, { error: "No group with that code. It may have expired." });

    if (b.action === "join") {
      const firstName = store.clean(b.firstName, 30);
      if (!firstName) return send(res, 400, { error: "Type your first name." });
      const out = await store.addMember(code, firstName);
      return out.error ? send(res, 409, out) : send(res, 200, { memberId: out.member.id, memberToken: out.memberToken });
    }

    if (b.action === "phase") {
      if (b.hostToken !== meta.hostToken) return send(res, 403, { error: "Only the person who opened the group can do that." });
      if (b.phase !== "collect" && b.phase !== "place") return send(res, 400, { error: "Unknown phase" });
      await store.setPhase(code, b.phase);
      return send(res, 200, { ok: true });
    }

    // Everything below acts on the caller's own things only.
    if (!(await store.checkMember(code, b.memberId, b.memberToken)))
      return send(res, 403, { error: "You're not in this group on this device. Join again." });

    switch (b.action) {
      case "persona": {
        const persona = { name: store.clean(b.name, 40), community: store.clean(b.community, 60) };
        await store.updatePersona(code, b.memberId, persona);
        return send(res, 200, { ok: true });
      }
      case "addProblem": {
        const text = store.clean(b.text, 120);
        if (!text) return send(res, 400, { error: "Write the problem first." });
        const out = await store.addProblem(code, b.memberId, text);
        return out.error ? send(res, 409, out) : send(res, 200, out);
      }
      case "editProblem":
      case "removeProblem": {
        const problem = await store.getProblem(code, b.problemId);
        if (!problem) return send(res, 404, { error: "That problem is gone." });
        if (problem.by !== b.memberId) return send(res, 403, { error: "You can only change problems you added." });
        if (b.action === "removeProblem") await store.removeProblem(code, b.problemId);
        else {
          const text = store.clean(b.text, 120);
          if (!text) return send(res, 400, { error: "Write the problem first." });
          await store.editProblem(code, problem, text);
        }
        return send(res, 200, { ok: true });
      }
      case "mark": {
        if (!(await store.getProblem(code, b.problemId))) return send(res, 404, { error: "That problem is gone." });
        let pct = null;
        if (b.pct !== null && b.pct !== undefined) {
          pct = Number(b.pct);
          if (!Number.isFinite(pct)) return send(res, 400, { error: "Bad position" });
          pct = Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
        }
        // The lane key is always built from the verified memberId, so nobody can write another person's dot.
        await store.setMark(code, b.memberId, b.problemId, pct);
        return send(res, 200, { ok: true });
      }
      default:
        return send(res, 400, { error: "Unknown action" });
    }
  } catch (e) {
    console.error("[board]", req.method, e && e.stack || e);
    return send(res, 500, { error: "Something went wrong. Try again." });
  }
}
