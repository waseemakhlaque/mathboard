# MathBoard — Teacher's Guide (accounts, papers, payments)

MathBoard is now **private**: nobody can use the board, papers, or search without
an account that *you* create. There is no self-signup and no pricing screen.
Everything runs on free tiers — **monthly cost: Rs. 0.**

Live site: **https://mathboard.waseemonline.workers.dev**

---

## Register a student (under a minute)

1. Sign in with your own account → press **Students** (top of the library screen).
2. Fill *Register new student*: name, phone, their email, a temporary password
   (at least 6 characters), and how many months of access.
3. Press **Register**, then send the student their email + password (WhatsApp/SMS).
4. The student opens the site on any device — smartboard, PC, iPad, phone —
   signs in, and everything works. They can change nothing about their account;
   only you can.

“1 month” always means 30 days, counted from today.

## Taking payments (for now — no gateway)

Collect the fee however you already do: **Raast / IBFT bank transfer, JazzCash,
EasyPaisa, or cash**. After the money reaches you, open **Students** and press
**+1 mo / +3 mo** next to the student — that extends their access from today or
from their current expiry, whichever is later. Press **Stop** to end access
immediately (e.g. a student who left).

When you're ready for automatic payments in a few months, see
`docs/PAYMENTS-LATER.md` — nothing in the app needs to change except one webhook.

## Past papers & books

Press **Past papers** in the library header. Everything is Cambridge 9709:

- **Past papers** — pick component (P1, P2, P3, Mechanics, S1, S2) and year;
  every question paper and mark scheme opens *directly onto the whiteboard*
  so you can write on it, or in a new tab.
- **Books & formulae** — coursebooks under 24 MB, the formulae booklet (MF19-style),
  and syllabuses. A few large coursebooks (P3 Oxford, S2 coursebook, …) are marked
  *"too large — ask your teacher"*; they can go online later by enabling
  **R2** in the Cloudflare dashboard (still free up to 10 GB) — ask your developer
  session to wire them up once R2 is enabled.

Papers are **never public**: every file is checked for a signed-in session at the
server, is marked `noindex` for search engines, and the app itself requires login.

## "Ask the syllabus" search

The search box on the Course Library tab finds topics inside the ingested papers.
Results now show **📄 Open paper** to jump straight to the source paper.

To finish/refresh the search index (uses the free daily Workers-AI quota,
which resets at **5:00 AM Pakistan time**):

```bash
cd ~/Downloads/mathboard-fresh/scripts
INGEST_TOKEN=<your ingest token> node rag-ingest.mjs            # past papers
INGEST_TOKEN=<your ingest token> node rag-ingest.mjs --books    # coursebooks
```

If it stops with a quota error, simply run the same command again after 5 AM —
it resumes where it left off (progress is saved in `.rag-ingest-progress.json`).

## Adding next year's papers

Put the new PDFs anywhere inside
`~/Documents/BSS/AS & A level Mathematics/Past Papers' Folder`
(named like `9709_s26_qp_12.pdf`), then:

```bash
cd ~/Downloads/mathboard-fresh
node scripts/collect-content.mjs     # copies + rebuilds the papers list
npx wrangler deploy                  # publishes
```

## One-time setup (already done unless noted)

1. **Supabase project** — free projects pause after ~1 week without traffic.
   If sign-in ever says "unavailable", open https://supabase.com/dashboard,
   choose the project, and press **Restore**. Daily classroom use keeps it awake.
2. **Your admin account** — if it ever needs recreating, in the Supabase dashboard:
   *Authentication → Add user* (email `asmamemon85@gmail.com` + a strong password),
   then *SQL Editor* → run:

   ```sql
   insert into public.profiles (user_id, role, full_name)
   select id, 'admin', 'Waseem Akhlaque'
   from auth.users where email = 'asmamemon85@gmail.com'
   on conflict (user_id) do update set role = 'admin';
   ```
3. **Deploys** (developer sessions do this for you):
   `npx supabase db push`, `npx supabase functions deploy admin`,
   `npx wrangler deploy`.

## Devices — quick notes

- **iPad**: open the site in Safari → Share → *Add to Home Screen* for the
  full-screen pencil experience. If the app ever looks stale, close it fully
  and reopen — it self-updates.
- **Smartboard / tuition-centre PC**: any modern Chrome/Firefox/Edge works;
  just sign in. Sign out (Sync dialog) on shared machines when you leave.
- **Offline**: drawing and saved lessons work without internet for up to a week
  per device; papers and search need internet.
