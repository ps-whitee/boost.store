# BoostStore

Run the app with the Node server:

```powershell
npm start
```

Then open:

- Storefront: `http://localhost:3000/`
- Admin panel: `http://localhost:3000/admin.html`

Admin login:

- Username: `darknet`
- Password: `insider`

## Firebase Email/Password Setup

1. Copy `.env.example` to `.env` and fill in your Firebase web config values.
2. In Firebase Console, enable `Authentication -> Sign-in method -> Email/Password`.
3. In Firebase Console, add your domain to `Authentication -> Settings -> Authorized domains`.
4. Restart the server after changing env values.

This setup uses Firebase only for main-page email/password auth. The rest of the app data stays on the local backend.
