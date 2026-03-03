# Invoice Realtime Delivery

## Overview

When User B opens the app:
1. **Initial fetch**: `GET /invoices` returns all past invoices (sent + received by phone/email).
2. **Realtime**: After connecting to the WebSocket, new invoices are delivered via `new_invoice` events.

## WebSocket Connection

- **Path**: `/invoice-socket`
- **Full URL**: `ws://<API_HOST>/invoice-socket` or `wss://<API_HOST>/invoice-socket` (production)
- **Transports**: WebSocket, polling (fallback)

### Authentication

Connect with one of:

1. **JWT token** (recommended when user is logged in):
   ```js
   const socket = io(API_URL, {
     path: '/invoice-socket',
     auth: { token: accessToken },
     transports: ['websocket', 'polling'],
   });
   ```

2. **Phone + optional token** (for recipients not yet logged in):
   ```js
   const socket = io(API_URL, {
     path: '/invoice-socket',
     query: { phone: '+919876543210' },
     auth: { token: accessToken }, // optional
     transports: ['websocket', 'polling'],
   });
   ```

### Subscribing to New Invoices

```js
socket.on('new_invoice', (invoice) => {
  // invoice = full invoice object from API
  console.log('New invoice received:', invoice);
  // Append to list, show notification, etc.
});
```

### Reconnection

Socket.IO handles reconnection automatically. After reconnect, the client re-subscribes based on `auth.token` or `query.phone`.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /invoices` | List all invoices (sent + received) for the authenticated user |
| `POST /invoices` | Create invoice (requires `recipient_phone` or `recipient_email`) |
| `GET /health/live` | Liveness probe |
| `GET /health/ready` | Readiness probe (checks DB) |

## Database

Invoices store `recipient_phone` and `recipient_email` for delivery. Ensure these columns exist:

```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recipient_email TEXT;
CREATE INDEX IF NOT EXISTS idx_invoices_recipient_phone ON invoices(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_invoices_recipient_email ON invoices(recipient_email);
```
