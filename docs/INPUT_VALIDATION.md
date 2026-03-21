# Input Validation & Sanitization

## Overview

All user input is validated and sanitized to prevent SQL injection, command injection, script injection, and unsafe file uploads.

## Measures

### 1. Global ValidationPipe

- **whitelist: true** – Strips properties not in the DTO
- **transform: true** – Coerces types (string→number, etc.)
- **forbidNonWhitelisted: false** – Allows unknown props on endpoints without DTOs (they are ignored)

### 2. Path Parameters

- **ParseUuidPipe** – All `:id`, `:itemId` params must be valid UUIDs
- Invalid IDs return `400 Bad Request` before any database access

### 3. DTOs with class-validator

| Endpoint        | DTO               | Validations                                      |
|----------------|-------------------|--------------------------------------------------|
| auth/register  | RegisterDto       | Email, password (8+), phone (10-digit Indian)    |
| auth/login     | LoginDto          | Email, password                                  |
| auth/refresh   | RefreshTokenDto   | refresh_token                                    |
| auth/forgot-password | ForgotPasswordDto | Email                  |
| auth/reset-password  | ResetPasswordDto | access_token, new_password (8+)     |
| customers      | Create/UpdateCustomerDto | Name, phone, email (max lengths)      |
| items          | Create/UpdateItemDto     | Name, rate (0–999M), description     |
| profiles       | UpdateProfileDto        | full_name, phone, email, pincode (6 digits) |
| push-token     | RegisterPushTokenDto    | Expo token format                  |

### 4. Sanitization Utilities (`common/validation/sanitize.util.ts`)

- **stripNullBytes** – Removes `\0` to prevent injection
- **safeString** – Truncates to max length, strips null bytes
- **parseUuid** – Validates UUID format
- **isAllowedImageType** – Only `png`, `jpeg`, `jpg`, `webp` (no SVG – can contain scripts)

### 5. File Upload (Avatar)

- Must match `data:image/(png|jpeg|jpg|webp);base64,...`
- Max 5MB
- Base64 decoded in try/catch to avoid crashes
- SVG and other types are rejected

### 6. Database Access

- Supabase client uses parameterized queries (no raw SQL concatenation)
- `escapeForLike()` in `recipient.util.ts` escapes `%` and `_` for LIKE patterns
- All IDs passed to `.eq()`, `.in()` are validated as UUIDs

### 7. Payments

- `invoiceId` validated as UUID
- `payerName`, `payerEmail`, `payerMobile` sanitized with `safeString()` and max lengths
- Email format and phone digits validated
