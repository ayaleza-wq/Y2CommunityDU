// Shared board storage on Upstash Redis.
// Every group lives under board:<CODE>:* and expires TTL seconds after it was opened.
import { Redis } from "@upstash/redis";
import crypto from "node:crypto";

// Vercel's Upstash integration sets one of these pairs; never hard-code them.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const hasDatabase = !!(REDIS_URL && REDIS_TOKEN);
const redis = hasDatabase ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

export const TTL = 72 * 60 * 60;
export const MAX_MEMBERS = 10;
export const MAX_PROBLEMS = 12;
export const COLORS = ["#42B6B4", "#E8B54A", "#C97BA0", "#7FA8C9", "#8E86C0",
                       "#E07A5F", "#7DB77A", "#B89B72", "#5E8FA0", "#D98FB0"];

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const k = (code, part) => `board:${code}:${part}`;
const PARTS = ["meta", "members", "tokens", "problems", "marks"];

export const token = () => crypto.randomBytes(16).toString("hex");
export const shortId = (p) => p + crypto.randomBytes(4).toString("hex");

export function clean(s, max) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);
}
export function normCode(c) {
  return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

async function touchTTL(code) {
  const meta = await redis.get(k(code, "meta"));
  if (!meta) return;
  const left = Math.max(60, TTL - Math.floor((Date.now() - meta.createdAt) / 1000));
  const p = redis.pipeline();
  PARTS.forEach((part) => p.expire(k(code, part), left));
  await p.exec();
}

export async function createGroup() {
  for (let tries = 0; tries < 8; tries++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    const meta = { code, createdAt: Date.now(), phase: "collect", hostToken: token() };
    const ok = await redis.set(k(code, "meta"), meta, { nx: true, ex: TTL });
    if (ok) return meta;
  }
  throw new Error("Could not find a free code");
}

export async function getMeta(code) {
  return code ? redis.get(k(code, "meta")) : null;
}

export async function setPhase(code, phase) {
  const meta = await getMeta(code);
  if (!meta) return null;
  meta.phase = phase;
  await redis.set(k(code, "meta"), meta, { keepTtl: true });
  return meta;
}

export async function readBoard(code) {
  const p = redis.pipeline();
  p.get(k(code, "meta"));
  p.hgetall(k(code, "members"));
  p.hgetall(k(code, "problems"));
  p.hgetall(k(code, "marks"));
  const [meta, members, problems, marks] = await p.exec();
  if (!meta) return null;
  const byMember = {};
  Object.entries(marks || {}).forEach(([key, v]) => {
    const [mid, pid] = key.split("|");
    (byMember[mid] = byMember[mid] || {})[pid] = Number(v);
  });
  return {
    code: meta.code,
    createdAt: meta.createdAt,
    phase: meta.phase,
    members: members || {},
    problems: Object.values(problems || {}).sort((a, b) => a.at - b.at),
    marks: byMember,
  };
}

export async function addMember(code, firstName) {
  const members = (await redis.hgetall(k(code, "members"))) || {};
  const count = Object.keys(members).length;
  if (count >= MAX_MEMBERS) return { error: "This group is full." };
  const used = new Set(Object.values(members).map((m) => m.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[count % COLORS.length];
  const id = shortId("m");
  const secret = token();
  const member = { id, firstName, persona: { name: "", community: "" }, color, at: Date.now() };
  const p = redis.pipeline();
  p.hset(k(code, "members"), { [id]: member });
  p.hset(k(code, "tokens"), { [id]: secret });
  await p.exec();
  await touchTTL(code);
  return { member, memberToken: secret };
}

// True only when memberToken matches the stored secret for memberId.
export async function checkMember(code, memberId, memberToken) {
  if (!memberId || !memberToken) return false;
  const stored = await redis.hget(k(code, "tokens"), memberId);
  return !!stored && stored === memberToken;
}

export async function updatePersona(code, memberId, persona) {
  const m = await redis.hget(k(code, "members"), memberId);
  if (!m) return null;
  m.persona = persona;
  await redis.hset(k(code, "members"), { [memberId]: m });
  return m;
}

export async function addProblem(code, memberId, text) {
  const n = await redis.hlen(k(code, "problems"));
  if (n >= MAX_PROBLEMS) return { error: "The board already has " + MAX_PROBLEMS + " problems." };
  const problem = { id: shortId("q"), text, by: memberId, at: Date.now() };
  await redis.hset(k(code, "problems"), { [problem.id]: problem });
  await touchTTL(code);
  return { problem };
}

export async function getProblem(code, problemId) {
  return redis.hget(k(code, "problems"), problemId);
}

export async function editProblem(code, problem, text) {
  problem.text = text;
  await redis.hset(k(code, "problems"), { [problem.id]: problem });
}

export async function removeProblem(code, problemId) {
  const marks = (await redis.hkeys(k(code, "marks"))) || [];
  const p = redis.pipeline();
  p.hdel(k(code, "problems"), problemId);
  marks.filter((key) => key.endsWith("|" + problemId)).forEach((key) => p.hdel(k(code, "marks"), key));
  await p.exec();
}

export async function setMark(code, memberId, problemId, pct) {
  const key = memberId + "|" + problemId;
  if (pct === null) await redis.hdel(k(code, "marks"), key);
  else {
    await redis.hset(k(code, "marks"), { [key]: pct });
    await touchTTL(code);
  }
}
