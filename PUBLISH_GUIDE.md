# 📤 How to publish this to GitHub — safely, one step at a time

This guide takes you from "folder on my Mac" to "private repo on GitHub" without
exposing your real email or any secrets. Do the steps in order. Copy **one line
at a time** into Terminal.

Before you start, replace the two placeholders in the files:
- In `SECURITY.md`: change `YOUR-CONTACT-EMAIL-HERE` to your **separate contact
  email** (e.g. an alias like `theexpert.router@gmail.com`, or `hello@floth.com`).
- (Optional) In `LICENSE`: change the author name if you want your name on it.

---

## Step 1 — Hide your commit email (do this ONCE, globally)

GitHub can hide your real email behind a `noreply` address so it never appears
in your commit history.

1. On GitHub: **Settings → Emails → tick "Keep my email address private."**
   It shows you an address like `12345678+username@users.noreply.github.com`.
   Copy it.
2. Point git at it (paste your noreply address where shown):

```
git config --global user.email "12345678+username@users.noreply.github.com"
```

```
git config --global user.name "Your GitHub Username"
```

Verify:

```
git config --global user.email
```

It should print the noreply address, **not** your personal email.

---

## Step 2 — Turn this folder into a git repo

```
cd ~/Downloads/the-expert-repo
```

```
git init
```

```
git add .
```

Now **check what's about to be committed** — this is your safety gate:

```
git status
```

You should see `web/`, `terminal/`, `README.md`, etc.
You should **NOT** see any `.env`, `*_profile.json`, or key files. If you do,
stop and tell me before continuing.

```
git commit -m "The Expert: initial commit (web + terminal editions)"
```

---

## Step 3 — Create a PRIVATE repo on GitHub

1. On GitHub: **New repository.**
2. Name it (e.g. `the-expert`).
3. **Choose "Private."** (You can flip it public later, after you're happy.)
4. Do **not** add a README/License/gitignore there — you already have them.
5. Create, then copy the two commands GitHub shows under
   "…or push an existing repository." They look like this (use YOUR url):

```
git remote add origin https://github.com/YOUR-USERNAME/the-expert.git
```

```
git branch -M main
```

```
git push -u origin main
```

Done — your code is now in a private repo only you can see.

---

## Step 4 — Turn on the free security tooling

On your repo: **Settings → (Advanced) Security**, and enable:

- **Secret scanning** + **Push protection** — blocks a push if it detects
  something that looks like an API key. Your safety net.
- **Dependabot alerts** — warns you if a library you use has a known
  vulnerability.

These are free and take about 30 seconds.

---

## Step 5 — Tag your first release: v1.0.0

Your internal build labels (the old "v2.6 web" / "v4.4 terminal") were just our
development counter. The **public** version starts fresh at **v1.0.0** — the
standard marker for "first real release." Both editions now show `v1.0.0`.

After your first push, create the release tag:

```
git tag -a v1.0.0 -m "The Expert v1.0.0 — first release (web + terminal editions)"
```

```
git push origin v1.0.0
```

Then on GitHub: **Releases → Draft a new release → choose tag `v1.0.0`**, title
it "The Expert v1.0.0", and add a short note, e.g.:

> First public release. Two editions of a Claude model & effort router: a
> browser app (bring your own key) and a terminal tool (runs on your Claude
> subscription). Routes each message to the right model, learns from your
> ratings, and tracks your savings.

**Future versions** follow semantic versioning: a bug fix is `v1.0.1`, a new
feature is `v1.1.0`, and the React rewrite — a big new chapter — becomes
`v2.0.0`.

## Step 6 — When you're ready to go public

Only after you've looked over everything one more time:

1. **Settings → General → Danger Zone → Change visibility → Public.**
2. Double-check `SECURITY.md` has your contact email, and the README reads well.
3. Add a short repo description and topics (e.g. `claude`, `llm`, `router`).

---

## What people will (and won't) see

- **Numbers, not names:** Insights → Traffic shows clone/view counts, but
  GitHub keeps individual cloners anonymous.
- **Named actions:** stars, forks, watchers, and issue/PR authors are public.
- **Your email:** hidden, because of Step 1.
- **Contact:** only the separate address you put in `SECURITY.md`.

## Keeping it current

When Anthropic ships or retires a model, update the IDs in
`web/index.html` (`MODELS` map) and `terminal/tracker.py` (`PRICES` map),
then:

```
git add -A && git commit -m "Update model lineup" && git push
```
