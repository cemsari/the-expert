# Security Policy

## Reporting a vulnerability

If you find a security issue in The Expert, please **do not open a public
issue**. Instead, email the maintainer privately at:

> **cems.ai.studio@gmail.com**

Please include steps to reproduce, and give a reasonable window for a fix
before any public disclosure. Thank you for reporting responsibly.

## What The Expert does and does not touch

The Expert is designed to keep secrets out of its own code and out of this
repository:

- **API keys are never stored in the code.**
  - The **web edition** asks each user for their own Anthropic API key and
    stores it only in that browser's `localStorage`. The key is sent directly
    to Anthropic's API and to no other server.
  - The **terminal edition** uses your local Claude Code sign-in and does not
    require an API key at all.
- **No telemetry.** Neither edition sends your prompts, ratings, or usage to
  any server operated by this project. Learning data stays on your device.
- **Bring-your-own-key means bring-your-own-billing.** Your API usage is
  billed to your own Anthropic account.

## For contributors

- Never commit a real API key, `.env` file, or personal profile data. The
  `.gitignore` blocks the common cases, but check `git status` before every
  commit.
- If a secret is ever committed by accident, **rotate it immediately** — git
  history is permanent, so removing the file later is not sufficient.
