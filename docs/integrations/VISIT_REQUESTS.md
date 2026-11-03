# Visit requests ("Plan your visit" form)

Status: built and unit-tested; **not verified against a real mail server** (CR-33, DEC-145, replaces DEC-144).

## What happens
1. The home-page form (`components/home/LeadForm.tsx`) checks the answers in the browser, then posts to `POST /visit-request`.
2. The server (`lib/leads/visit-handler.ts`) allows same-origin posts only, drops honeypot posts quietly, rate limits (per client address, per phone number, overall), validates again, then sends **one plain-text email** over SMTP (`lib/leads/smtp-client.ts`).
3. The email goes To `LEAD_EMAIL_TO` with everyone in `LEAD_EMAIL_CC` copied. It lists name, phone, ZIP, budget, when they can visit and the time received. The body is base64 UTF-8, so nothing a visitor types can alter the mail headers.
4. The lead analytics event (`generate_lead`) fires only after the server says the email was sent. Nothing is stored by the storefront.

## Settings (server environment only)
| Name | Needed | Meaning |
|---|---|---|
| `SMTP_HOST` | yes | Mail server name |
| `SMTP_PORT` | no | Defaults to 587 (starttls), 465 (tls), 25 (none) |
| `SMTP_SECURITY` | no | `starttls` (default), `tls` (implicit TLS) or `none` (no encryption, no login; a local mail catcher only) |
| `SMTP_USER`, `SMTP_PASSWORD` | no | A pair, both or neither. Refused with `none`. The password is a secret: environment only, never in a file or log |
| `SMTP_FROM` | yes | Sender address |
| `LEAD_EMAIL_TO` | yes | The one address that receives each request |
| `LEAD_EMAIL_CC` | no | Comma-separated copies, up to 10, for example `owner@example.com,manager@example.com` |

A missing or malformed required setting means the form answers "could not send your request right now" (503) and logs `visit_request.unavailable` with the setting **names** (never values). Nothing is faked.

## Where it works
Sending needs raw network connections, so it works on the **plain-Node VPS** (ADR-0011) only. On Shopify Oxygen and in `npm run dev` (a worker) the send answers `unsupported_runtime` and the form says it cannot send. To try it locally, run the production build with the Node adapter (`npm run build`, then `npm run start:node` in `storefront/`) with the settings above, for example against a local mail catcher with `SMTP_SECURITY=none`.

## Security notes
- Certificates are always verified. With `starttls`, if the server does not offer encryption the send fails (`tls_required`) instead of sending in the clear.
- Addresses are checked for line breaks and special characters before they reach an SMTP command or a header.
- Logs hold event names, setting names and reason codes (`connect`, `timeout`, `auth`, `tls_required`, `rejected`, `protocol`, `unsupported_runtime`), never a name, phone number, address, reply text or password.
- Name and phone reach only the mailbox(es) you configured. The form tells the visitor the details are used only to arrange the visit.

## To verify (needs the owner's mail account)
Send a test request with a fictional 555 number and confirm it arrives in To and Cc. Try a wrong password (log reason `auth`) and a closed port (`connect`). The STARTTLS and TLS handshakes have not been run against a real server.
