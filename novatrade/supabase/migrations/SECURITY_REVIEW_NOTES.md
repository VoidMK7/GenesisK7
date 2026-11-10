# Security findings from the read-only audit of the existing Supabase project

These are observations only. Nothing was changed. Review each before acting.

1. **Plaintext secrets.** `user_ai_keys.api_key` and `admin_ai_config.api_key` are plain text columns.
   The product brief requires encrypted server-side storage. Suggested direction: move to Supabase Vault
   and store only a `vault_secret_id` reference. `feed_secret.secret` and `demo_accounts.secret` look similar.
2. **SECURITY DEFINER functions callable by signed-in users (49).** This includes `admin_adjust_balance`,
   `admin_credit_deposit` and `admin_review_withdrawal`. Confirm each begins with an `is_admin()` check.
   If it does not, revoke EXECUTE from `authenticated` for it.
3. **Anonymous access.** `public._sig_info(text, text)` is SECURITY DEFINER and executable by `anon`.
4. **RLS enabled with no policies** on `admin_ai_config`, `ai_usage`, `copy_positions`, `demo_accounts`,
   `feed_secret`, `post_likes`, `posts`, `user_ai_keys`, `wallet_nonces`. For secret tables this is correct
   (deny by default); for `posts` and `post_likes` confirm the app reads them only through RPCs.
5. **Mutable search_path** on `public._uid`.
6. **`pg_net`** is installed in the `public` schema.
7. **Leaked-password protection** is disabled in Supabase Auth settings.
8. **Roles.** `user_roles.role` is constrained to the single value `admin`. The brief asks for
   role-based access control; a wider role set will need a migration.
