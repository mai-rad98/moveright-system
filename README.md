# MoveRight Management System

Simple MERN app: MongoDB + Express (server) and React (client).

## Run it (development)

You need Node 18+ and MongoDB running locally (or a MongoDB Atlas link).

```bash
# 1. Server
cd server
npm install
cp .env.example .env      # then edit .env (JWT_SECRET, admin email/password, MONGO_URI)
npm run dev               # http://localhost:5000

# 2. Client (new terminal)
cd client
npm install
npm run dev               # http://localhost:5173
```

Log in with the ADMIN_EMAIL / ADMIN_PASSWORD from `.env`. That first admin is created automatically.

## Run it (production, one server)

```bash
cd client && npm install && npm run build     # creates client/dist
cd ../server && npm start                      # serves the API and the built app together
```

## Who sees what

| Area | Who | What |
|------|-----|------|
| `/admin` | admin | Dashboard with money, Inbox, Jobs (with partner costs), Prices, Partners, Expenses, Users |
| `/users` | staff | Dashboard (messages only), Inbox, Jobs (no partner costs), Prices (read only) |

## Modules

- **Prices**: services and locations, each with a price. Add, update, delete (admin only; staff can read).
  We have no trucks, so each location has a partner (picked from Partners), the partner price and our markup in Pula.
  Client price (full) = partner price + our markup, worked out automatically on add and edit. Staff only see the client price.
- **Partners**: name, phone and the service they provide. Partner prices and our markup are set per location under Prices.
- **Jobs**: customer, from/to, date, status (quoted, confirmed, completed, cancelled), source, price charged, partner, amount paid to partner. "Our share" = price charged minus partner cost.
- **Expenses**: business costs by category.
- **Inbox**: every Facebook/WhatsApp message and comment, with a category (price / location / booking / other) and a Responded flag.
- **Dashboard**: messages today, price/location enquiries today, comments responded to today, 14-day chart, enquiry-to-job rate, revenue, partner payments, markup, expenses and net profit.
  Net profit = revenue from completed jobs − partner payments − expenses.

### Date selector and reports (every module)

- Each module has a **Date** bar (Today, Yesterday, Last 7 days, This month, Last month, This year, All time, or any custom range, with ◀ ▶ to step back and forward). The choice carries across modules for the browser tab.
- **Inbox, Jobs, Expenses**: the list shows only records in the chosen dates, and **+ Add** pre-fills the chosen day (e.g. pick Yesterday to enter yesterday's messages). Inbox items now have an editable Received date/time.
- **Prices, Partners, Users**: the lists always show everything; the date only changes the report.
- Every module shows a report: headline figures compared with the previous period of the same length, charts per day (per month for long periods) and breakdown tables with totals. **Print / PDF** prints the report; **Export CSV** downloads the list.
- The Users report shows who entered what. This tracking starts with this version, so older records show as "Automatic or not tracked".

## Connecting Facebook and WhatsApp (optional, do later)

The Inbox works without this: staff can add messages by hand with **+ Add**.
To fill it automatically, create a Meta app (developers.facebook.com) with Messenger and WhatsApp Cloud API, then:

1. Put your server on a public HTTPS address.
2. In Meta's webhook settings, set the callback URL to `https://YOUR-DOMAIN/webhook/meta` and the verify token to `META_VERIFY_TOKEN` from `.env`.
3. Page webhook: subscribe to `messages` and `feed`. WhatsApp webhook: subscribe to `messages`.
4. Put your App Secret in `META_APP_SECRET` (requests are then signature-checked) and your Facebook Page ID in `FB_PAGE_ID`.

How it behaves:
- Messages are categorised by keywords (price words, your location names, booking words). Staff can correct the category.
- Facebook: when you reply in Messenger or to a comment, the item is marked Responded automatically.
- WhatsApp: Meta does not send your replies to the webhook, so click **Mark responded** in the Inbox.
- Meta needs app review and a business account before live use. Expect some setup time.

## Not included yet (good next steps)

Customer quotes/invoices, payment tracking, job calendar, reports export, password reset, WhatsApp auto-replies.
