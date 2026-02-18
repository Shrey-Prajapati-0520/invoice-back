# SabPaisa Payment Gateway - Setup Instructions

## Where to Put Each Key

Add these keys to your **`invoicebill-backend/.env`** file:

| Key | Where to Get It | Example |
|-----|-----------------|---------|
| **SABPAISA_CLIENT_CODE** | SabPaisa Account Manager / Partner Dashboard | `DJ020` |
| **SABPAISA_TRANS_USERNAME** | SabPaisa Account Manager / Partner Dashboard | `DJL754@sp` |
| **SABPAISA_TRANS_PASSWORD** | SabPaisa Account Manager / Partner Dashboard | `4q3qhgmJNM4m` |
| **SABPAISA_AUTH_KEY** | Authentication Key (16 chars) from SabPaisa | `your_16_char_key` |
| **SABPAISA_AUTH_IV** | Authentication IV (16 chars) from SabPaisa | `your_16_char_iv` |
| **SABPAISA_MCC** | Merchant Category Code (usually provided) | `5666` |
| **SABPAISA_BASE_URL** | Environment Base URL from SabPaisa | See below |
| **SABPAISA_CALLBACK_URL** | Your backend URL + `/payments/callback` | See below |

---

## Environment Base URL

| Environment | SABPAISA_BASE_URL |
|-------------|-------------------|
| **Staging (UAT)** | `https://stage-securepay.sabpaisa.in/SabPaisa/sabPaisaInit?v=1` |
| **Live** | `https://securepay.sabpaisa.in/SabPaisa/sabPaisaInit?v=1` |

Use the staging URL for testing. Switch to live URL when going to production.

---

## Callback URL

**SABPAISA_CALLBACK_URL** must be a **publicly accessible URL** where SabPaisa will POST the payment result.

| Environment | Example |
|-------------|---------|
| **Local (ngrok)** | `https://abc123.ngrok.io/payments/callback` |
| **Railway** | `https://your-app.up.railway.app/payments/callback` |
| **Production** | `https://api.yourdomain.com/payments/callback` |

**Important:** For local testing, SabPaisa cannot reach `localhost`. Use [ngrok](https://ngrok.com) to expose your local backend:
```bash
ngrok http 3000
```
Then set `SABPAISA_CALLBACK_URL=https://YOUR_NGROK_URL/payments/callback`

---

## Example .env (Staging)

```env
# SabPaisa
SABPAISA_CLIENT_CODE=DJ020
SABPAISA_TRANS_USERNAME=DJL754@sp
SABPAISA_TRANS_PASSWORD=4q3qhgmJNM4m
SABPAISA_AUTH_KEY=your_auth_key_16
SABPAISA_AUTH_IV=your_auth_iv_16
SABPAISA_MCC=5666
SABPAISA_BASE_URL=https://stage-securepay.sabpaisa.in/SabPaisa/sabPaisaInit?v=1
SABPAISA_CALLBACK_URL=https://your-ngrok-url.ngrok.io/payments/callback
```

---

## Auth Key & Auth IV Length

- **Auth Key** and **Auth IV** must be exactly **16 characters** each for AES-128.
- If SabPaisa sends longer keys, use the first 16 characters.
- If shorter, the code pads with zeros.

---

## Support

- **SabPaisa Support:** client.support@sabpaisa.in
- **Integration Support:** integration.support@sabpaisa.in
- **Developer Docs:** https://developer.sabpaisa.in/

