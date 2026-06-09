# Namiya Backend

Simple Node.js backend with no external dependencies.

## Run

```bash
cd backend
npm run dev
```

Default server: `http://localhost:3001`

## Fixed Admin Login

- Account: `keeper`
- Password: `namiya123`

You can override them with environment variables:

- `ADMIN_ACCOUNT`
- `ADMIN_PASSWORD`
- `ADMIN_TOKEN`

## API

### Health

`GET /api/health`

### Admin login

`POST /api/admin/login`

```json
{
  "account": "keeper",
  "password": "namiya123"
}
```

### Create anonymous letter

`POST /api/letters`

```json
{
  "content": "您好，我最近……"
}
```

### Get all letters for admin

`GET /api/admin/letters`

Header:

```txt
Authorization: Bearer namiya-admin-token
```

### Save admin reply

`POST /api/admin/letters/:id/reply`

```json
{
  "reply": "我已經讀完你的來信。"
}
```
