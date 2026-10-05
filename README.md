# The Problems and My Community — shared group board (MEET Y2)

One person opens a group and gets a 5-letter code and a QR. Everyone joins on their own device and adds their **person** (who represents their community) and their **problems**. Once the host starts the board, each problem has an Easy ↔ Difficult spectrum, and every student places **their own person** on every problem. Everyone sees all the dots live. A student can move or remove only their own dots.

## How it's built
- `index.html`: the whole page (no build step).
- `api/board.js`: one Vercel serverless function. `GET ?code=` returns the board, and `POST {action}` handles create / join / persona / addProblem / editProblem / removeProblem / mark / phase.
- `lib/store.js`: storage on Upstash Redis. Every group expires **72 hours** after it was opened.
- Who's who: joining returns a `memberToken` that only that device keeps. The server only lets a member write their own dots and problems. Opening a group returns a `hostToken`, and only the host can start or stop placing. Tokens are never sent back in the board data.

## Deploying (MEET Vercel account)
1. Push this folder to a repo under MEET's GitHub and import it into the existing `meet-community-board` Vercel project. Or create a new project, then move the domain over.
2. In Vercel, go to **Storage → Marketplace → Upstash (Redis)** and connect it to this project. That sets the env vars (`KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). **Never paste these into code.**
3. Deploy to a **preview URL** first. Test it with 3 devices, then promote to production.

## Data
First names, a person's name or role, a community, and problem text. Nothing else is collected. There's no list of groups, and every group deletes itself after 72h.
